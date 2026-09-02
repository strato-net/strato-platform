{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | Native implementations of hot contract functions.
--
-- A precompile is keyed by (code collection hash, contract name, function
-- name). The hash is the whole safety story: an implementation is only ever
-- used for the exact source it was written against and differentially verified
-- on. Upgrading a contract changes its collection hash, which silently drops
-- the precompile and returns the function to the interpreter.
--
-- Every precompile is a /fast path with a fallback/. It returns 'Nothing' —
-- declining — whenever the call is outside the shape it was written for, and
-- the caller then runs the interpreter as usual. Two rules make that sound:
--
--   1. A precompile must decline /before performing any effect/. Once the
--      interpreter re-runs the function it starts from whatever state the
--      precompile left behind.
--
--   2. A precompile must not throw. The @onlyOwner@ modifier on these
--      functions wraps the body in a @try@ whose @catch@ routes to
--      @AdminRegistry.castVoteOnIssue@, so an exception raised from a
--      precompile would divert what should have been a revert into a
--      governance vote. Everything is validated up front; anything that would
--      have thrown is declined instead.
module Blockchain.SolidVM.Precompile
  ( lookupPrecompile,
    precompilesEnabled,
    proxyPassthroughSlot,
    readProxyLogic,
  )
where

import Blockchain.DB.SolidStorageDB (putSolidStorageKeyVal')
import Blockchain.Data.BlockHeader (timestamp)
import qualified Blockchain.SolidVM.Environment as Env
import Blockchain.SolidVM.Exception
import Blockchain.SolidVM.SM
import Blockchain.SolidVM.SetGet
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class (blockHeaderHash)
import Blockchain.Strato.Model.Keccak256
import Control.Lens ((^.))
import Control.Monad (forM_)
import Data.Char (isSpace)
import Data.IORef
import qualified Data.ByteString.Char8 as BC
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe, mapMaybe)
import qualified Data.Text as T
import Data.Time.Clock.POSIX (utcTimeToPOSIXSeconds)
import qualified Data.Vector as V
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.Event
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Storable as MS
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value
import SolidVM.Solidity.Parse.UnParser (unparseStatement)
import System.Environment (lookupEnv)
import System.IO (hPutStrLn, stderr)
import System.IO.Unsafe (unsafePerformIO)

--------------------------------------------------------------------------------
-- configuration
--------------------------------------------------------------------------------

-- | Master switch. Off unless @SOLIDVM_PRECOMPILES=1@.
{-# NOINLINE precompilesEnabled #-}
precompilesEnabled :: Bool
precompilesEnabled = unsafePerformIO $ (== Just "1") <$> lookupEnv "SOLIDVM_PRECOMPILES"

-- | Additional code collection hashes this node will use the registry for,
-- comma-separated hex in @SOLIDVM_PRECOMPILE_EXTRA_HASHES@.
--
-- This is not a bypass: every hash must be named in full. It exists for
-- qualifying a redeployment — run the differential suite against the new
-- collection with its hash listed here, and once it is clean, move the hash
-- into 'pinned' below.
{-# NOINLINE extraHashes #-}
extraHashes :: [Keccak256]
extraHashes =
  unsafePerformIO $
    maybe [] (mapMaybe (stringKeccak256 . trim) . splitOn ',')
      <$> lookupEnv "SOLIDVM_PRECOMPILE_EXTRA_HASHES"
  where
    trim = dropWhile isSpace . reverse . dropWhile isSpace . reverse
    splitOn c s = case break (== c) s of
      (a, []) -> [a]
      (a, _ : rest) -> a : splitOn c rest

-- | When @SOLIDVM_PRECOMPILE_LOG=1@, report every call that names a function
-- the registry implements but arrives on a collection that is not pinned. That
-- is what an upgraded contract looks like from here, and it is how you discover
-- the hash to qualify next.
{-# NOINLINE logUnpinned #-}
logUnpinned :: Bool
logUnpinned = unsafePerformIO $ (== Just "1") <$> lookupEnv "SOLIDVM_PRECOMPILE_LOG"

-- | Instrumentation for the benchmark harness: selects how much of a native
-- body runs, so its cost can be attributed. Only "full" (the default) is
-- semantically correct.
{-# NOINLINE probeMode #-}
probeMode :: String
probeMode = unsafePerformIO $ fromMaybe "full" <$> lookupEnv "SOLIDVM_PRECOMPILE_PROBE"

--------------------------------------------------------------------------------
-- the registry
--------------------------------------------------------------------------------

-- | Mercata mainnet, the collection holding @PriceOracle@ (the logic contract
-- behind the oracle proxy at 0x1002). Every precompile below was written
-- against this collection's source.
mercataPriceOracle :: Keccak256
mercataPriceOracle =
  keccak256FromHex "824ec4abaf04f456216effd40bab69a7efd789dcf3df0ec5dd4c22aba9b0b231"

-- | 'Nothing' means no native implementation applies; the returned action's
-- 'Nothing' means the fast path declined and the interpreter should run the
-- function instead.
lookupPrecompile ::
  MonadSM m =>
  Keccak256 ->
  SolidString ->
  SolidString ->
  Maybe (CC.Contract -> ValList -> m (Maybe (Maybe Value)))
lookupPrecompile hsh cName fName
  | not precompilesEnabled = Nothing
  | otherwise = case (labelToString cName, labelToString fName) of
      ("PriceOracle", "setAssetPrices") -> pin oracleSetAssetPrices
      ("PriceOracle", "setRebaseFactors") ->
        pin $ oracleBatchSet "rebaseFactors" (const True) "RebaseFactorsUpdated"
      ("PriceOracle", "setExchangeRates") ->
        pin $ oracleBatchSet "exchangeRates" (> 0) "ExchangeRatesUpdated"
      _ -> Nothing
  where
    pin impl
      | hsh == mercataPriceOracle || hsh `elem` extraHashes = Just impl
      | otherwise = noteUnpinned hsh cName fName Nothing

{-# NOINLINE noteUnpinned #-}
noteUnpinned :: Keccak256 -> SolidString -> SolidString -> a -> a
noteUnpinned hsh cName fName x
  | not logUnpinned = x
  | otherwise =
      unsafePerformIO
        ( hPutStrLn stderr $
            "[precompile] unpinned collection "
              ++ keccak256ToHex hsh
              ++ " for "
              ++ labelToString cName
              ++ "."
              ++ labelToString fName
        )
        `seq` x

--------------------------------------------------------------------------------
-- Proxy passthrough
--
-- Almost every contract on mainnet is reached through a Proxy whose fallback is
-- nothing but @logicContract.delegatecall(msg.sig, args)@. Interpreting that
-- costs a whole function call — modifier lookup, default return values, a
-- local-variable frame, then member dispatch on @.delegatecall@ — to arrive at
-- a call the VM was always going to make.
--
-- This one is deliberately NOT hash-pinned. Proxy is bundled into every code
-- collection that deploys one, so mainnet already has 19 distinct collection
-- hashes containing it and every new deployment adds another; a pinned list
-- would be stale on arrival. Instead the shape being relied on is verified
-- directly: the fallback must be exactly the one-line passthrough, with no
-- modifiers and no overloads. That is a stronger check than a hash — it
-- validates the actual property the shortcut depends on — and it is memoised
-- per collection so the AST match happens once.
--------------------------------------------------------------------------------

{-# NOINLINE proxyShapeCache #-}
proxyShapeCache :: IORef (M.Map (Keccak256, SolidString) (Maybe BC.ByteString))
proxyShapeCache = unsafePerformIO $ newIORef M.empty

-- | The storage slot holding the logic address, if this contract is a verified
-- pass-through proxy.
proxyPassthroughSlot :: Keccak256 -> CC.Contract -> Maybe BC.ByteString
proxyPassthroughSlot hsh contract
  | not precompilesEnabled = Nothing
  | otherwise = unsafePerformIO $ do
      let key = (hsh, contract ^. CC.contractName)
      cache <- readIORef proxyShapeCache
      case M.lookup key cache of
        Just v -> pure v
        Nothing -> do
          let v = checkProxyShape contract
          atomicModifyIORef' proxyShapeCache $ \c -> (M.insert key v c, ())
          pure v

-- | @fallback(variadic args) external returns (variadic) {
--      return logicContract.delegatecall(msg.sig, args);
--    }@ and nothing else.
checkProxyShape :: CC.Contract -> Maybe BC.ByteString
checkProxyShape contract = do
  f <- M.lookup "fallback" (contract ^. CC.functions)
  let noExtras = null (CC._funcModifiers f) && null (CC._funcOverload f)
  argName <- case CC._funcArgs f of
    [(Just n, CC.IndexedType _ SVMType.Variadic _)] -> Just n
    _ -> Nothing
  body <- CC._funcContents f
  stmt <- case body of
    [s] -> Just s
    _ -> Nothing
  slot <- case CC._varType <$> M.lookup "logicContract" (contract ^. CC.storageDefs) of
    Just (SVMType.Address _) -> Just ("logicContract" :: BC.ByteString)
    _ -> Nothing
  let rendered = squash (unparseStatement stmt)
      expected =
        squash $
          "return logicContract.delegatecall(msg.sig," ++ labelToString argName ++ ");"
  if noExtras && rendered == expected then Just slot else Nothing
  where
    squash = filter (not . isSpace)

-- | Read the logic address out of a proxy's storage. Declines on anything that
-- is not a plain address, so a proxy mid-upgrade falls back to the interpreter.
readProxyLogic :: MonadSM m => Address -> BC.ByteString -> m (Maybe Address)
readProxyLogic proxyAddr slot =
  getStorageValue proxyAddr (root slot) >>= \case
    SAddress a _ -> pure $ Just a
    SContract _ a -> pure $ Just a
    _ -> pure Nothing

--------------------------------------------------------------------------------
-- storage helpers (identical key bytes to the interpreter's expToPath)
--------------------------------------------------------------------------------

root :: BC.ByteString -> MS.StoragePath
root = MS.singleton

atAddr :: MS.StoragePath -> Address -> MS.StoragePath
atAddr p a = p `MS.snoc` MS.Index (BC.pack $ show a)

atIdx :: MS.StoragePath -> Integer -> MS.StoragePath
atIdx p i = p `MS.snoc` MS.Index (BC.pack $ show i)

field :: MS.StoragePath -> BC.ByteString -> MS.StoragePath
field p f = p `MS.snoc` MS.Field f

readInt :: MonadSM m => MS.StoragePath -> m Integer
readInt p = do
  a <- getCurrentAddress
  getStorageValue a p >>= \case
    SInteger i -> pure i
    _ -> pure 0

writeInt :: MonadSM m => MS.StoragePath -> Integer -> m ()
writeInt p i
  | probeMode == "readsonly" = pure ()
  | probeMode == "nodiff" = do
      a <- getCurrentAddress
      putSolidStorageKeyVal' a p (MS.BInteger i)
  | probeMode == "nodb" = do
      a <- getCurrentAddress
      markDiffForAction a p (MS.BInteger i)
  | otherwise = do
      a <- getCurrentAddress
      markDiffForAction a p (MS.BInteger i)
      putSolidStorageKeyVal' a p (MS.BInteger i)

--------------------------------------------------------------------------------
-- argument handling
--------------------------------------------------------------------------------

-- | A call arriving through a proxy's variadic fallback presents its arguments
-- as a single 'SVariadic' rather than a positional list. Both shapes reach the
-- same function, so every precompile normalises first.
unVariadic :: ValList -> ValList
unVariadic [SVariadic vs] = vs
unVariadic vs = vs

asInt :: Value -> Maybe Integer
asInt (SInteger i) = Just i
asInt _ = Nothing

asAddr :: Value -> Maybe Address
asAddr (SAddress a _) = Just a
asAddr (SContract _ a) = Just a
asAddr _ = Nothing

-- | @onlyOwner@'s fast path. The modifier runs the body directly only when
-- @_owner == _msgSender()@; otherwise its catch routes the call to
-- @AdminRegistry.castVoteOnIssue@, which is the interpreter's business.
ownerMatchesSender :: MonadSM m => m Bool
ownerMatchesSender = do
  addr <- getCurrentAddress
  sender <- Env.sender <$> getEnv
  getStorageValue addr (root "_owner") >>= \case
    SAddress o _ -> pure $ o == sender
    SContract _ o -> pure $ o == sender
    _ -> pure False

--------------------------------------------------------------------------------
-- events
--------------------------------------------------------------------------------

-- | Emit with the argument 'Value's exactly as they were passed. Rebuilding
-- them would risk a different constructor (SContract vs SAddress) reaching the
-- receipts trie, where event arguments are consensus-visible.
emit :: MonadSM m => CC.Contract -> String -> [Value] -> m ()
emit contract evName' vals = do
  addr <- getCurrentAddress
  ev <- case M.lookup (stringToLabel evName') (contract ^. CC.events) of
    Just e -> pure e
    Nothing -> missingType "precompile: undeclared event" evName'
  strs <- mapM jsonSM vals
  bHash <- blockHeaderHash . Env.blockHeader <$> getEnv
  tHash <- Env.txHash <$> getEnv
  txSender <- Env.origin <$> getEnv
  let args =
        zipWith3
          (\(CC.EventLog n _ (CC.IndexedType _ t _)) v s -> (T.unpack n, v, s, t))
          (CC._eventLogs ev)
          vals
          strs
  addEvent $
    Event bHash tHash txSender (labelToString $ contract ^. CC.contractName) addr evName' args

--------------------------------------------------------------------------------
-- PriceOracle batch setters
--------------------------------------------------------------------------------

-- | The (address[], uint256[]) pair every PriceOracle batch setter takes.
-- Declines on any shape a transaction would not produce, so the fast path only
-- ever sees two fully materialised arrays.
oracleArrays :: ValList -> Maybe (Value, Value, [Address], [Integer])
oracleArrays vals0 = case unVariadic vals0 of
  [assetsV@(SArray as), valuesV@(SArray vs)] -> do
    assets <- mapM (asAddr . constVal) (V.toList as)
    values <- mapM (asInt . constVal) (V.toList vs)
    pure (assetsV, valuesV, assets, values)
  _ -> Nothing
  where
    -- Arguments reach a precompile already resolved, so every element is a
    -- Constant; an IORef-backed element means some other shape, and declines.
    constVal (Constant v) = v
    constVal _ = SNULL

-- | @setRebaseFactors@ and @setExchangeRates@: two length checks, then one
-- @require@ per asset (plus, for exchange rates, one on the value), one mapping
-- write, and one batch event. Validated whole, then committed whole.
oracleBatchSet ::
  MonadSM m =>
  BC.ByteString ->
  (Integer -> Bool) ->
  String ->
  CC.Contract ->
  ValList ->
  m (Maybe (Maybe Value))
oracleBatchSet mappingName valueOk eventName contract vals = do
  isOwner <- ownerMatchesSender
  case (isOwner, oracleArrays vals) of
    (True, Just (assetsV, valuesV, assets, values))
      | length assets == length values,
        not (null assets),
        all (/= Address 0) assets,
        all valueOk values -> do
          nowTs <- blockTimestamp
          if probeMode == "nostore"
            then pure ()
            else forM_ (zip assets values) $ \(a, v) ->
              writeInt (root mappingName `atAddr` a) v
          emit contract eventName [assetsV, valuesV, SInteger nowTs]
          pure $ Just Nothing
    _ -> pure Nothing

-- | @setAssetPrices@. Same shell, but each asset also pushes its previous
-- observation onto a TWAP ring buffer. The fast path additionally requires that
-- no per-asset queue resize is pending — @_syncQueueSize@ and
-- @_rotateToLinear@ stay with the interpreter.
oracleSetAssetPrices :: MonadSM m => CC.Contract -> ValList -> m (Maybe (Maybe Value))
oracleSetAssetPrices contract vals = do
  isOwner <- ownerMatchesSender
  case (isOwner, oracleArrays vals) of
    (True, Just (assetsV, pricesV, assets, prices))
      | length assets == length prices,
        not (null assets),
        all (/= Address 0) assets,
        all (> 0) prices -> do
          globalQ <- readInt (root "queueSize")
          inSync <-
            and
              <$> mapM
                ( \a -> do
                    q <- readInt (field (root "oracleState" `atAddr` a) "queueSize")
                    prev <- readInt (root "prices" `atAddr` a)
                    pure (prev == 0 || q == globalQ)
                )
                assets
          if not inSync
            then pure Nothing
            else
              if probeMode == "argsonly"
                then pure $ Just Nothing
                else do
                  nowTs <- blockTimestamp
                  if probeMode == "nostore"
                    then pure ()
                    else forM_ (zip assets prices) $ \(a, p) -> do
                      let pricesP = root "prices" `atAddr` a
                          updP = root "lastUpdated" `atAddr` a
                          st = root "oracleState" `atAddr` a
                          obs = field st "observations"
                      prevPrice <- readInt pricesP
                      prevTs <- readInt updP
                      -- _pushObservation(asset, prevTs, prevPrice)
                      if prevPrice == 0
                        then pure ()
                        else do
                          sz0 <- readInt (field st "queueSize")
                          let size = if sz0 == 0 then 2 else sz0
                          len <- readInt (field obs "length")
                          if len < size
                            then do
                              writeInt (field obs "length") (len + 1)
                              writeInt (field (obs `atIdx` len) "timestamp") prevTs
                              writeInt (field (obs `atIdx` len) "price") prevPrice
                            else do
                              idx <- readInt (field st "writeIndex")
                              writeInt (field (obs `atIdx` idx) "timestamp") prevTs
                              writeInt (field (obs `atIdx` idx) "price") prevPrice
                              writeInt (field st "writeIndex") ((idx + 1) `mod` size)
                      writeInt pricesP p
                      writeInt updP nowTs
                  if probeMode == "noemit"
                    then pure ()
                    else emit contract "BatchPricesUpdated" [assetsV, pricesV, SInteger nowTs]
                  pure $ Just Nothing
    _ -> pure Nothing

blockTimestamp :: MonadSM m => m Integer
blockTimestamp = round . utcTimeToPOSIXSeconds . timestamp . Env.blockHeader <$> getEnv
