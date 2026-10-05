{-# LANGUAGE OverloadedStrings, LambdaCase, ScopedTypeVariables #-}
module Main where

import Blockchain.SolidVM.CodeCollectionDB (compileSourceWithAnnotationsWithoutImports)
import Blockchain.Strato.Model.Address (Address (..))
import Control.Exception
import Control.Monad
import Control.Monad.Reader
import qualified Data.Aeson as Aeson
import qualified Data.ByteString.Lazy as BL
import Data.IORef
import Data.List (sortOn)
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import qualified Data.Text.IO as T
import SolidVM.Model.CodeCollection (CodeCollection)
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.Storable (BasicValue (..), StoragePath (..), StoragePathPiece (..), isDefault)
import System.Directory (listDirectory)
import System.Environment
import System.FilePath ((</>))
import Text.Printf
import Core
import Compile

loadSource :: FilePath -> IO (M.Map T.Text T.Text)
loadSource file = do
  bs <- BL.readFile file
  case Aeson.decode bs of
    Just l -> pure (M.fromList (l :: [(T.Text, T.Text)]))
    Nothing -> case Aeson.decode bs of
      Just s -> pure (M.singleton T.empty (s :: T.Text))             -- /eth/v1.2/code returns a JSON string
      Nothing -> pure (M.singleton T.empty (TE.decodeUtf8 (BL.toStrict bs)))

parseCC :: M.Map T.Text T.Text -> Either String CodeCollection
parseCC src = either (Left . show) Right (compileSourceWithAnnotationsWithoutImports False False src)

-- ---------------------------------------------------------------- census

census :: FilePath -> IO ()
census dir = do
  files <- sortOn id <$> listDirectory dir
  summary <- newIORef (M.empty :: M.Map T.Text Int)
  totals <- newIORef (0 :: Int, 0 :: Int, 0 :: Int, 0 :: Int)   -- collections, parse failures, functions ok, functions failed
  forM_ files $ \f -> do
    src <- loadSource (dir </> f)
    case parseCC src of
      Left e -> do
        printf "%s: PARSE FAILED %s\n" f (take 200 e)
        modifyIORef' totals (\(a, b, c, d) -> (a + 1, b + 1, c, d))
      Right cc -> do
        let col = compileCollection cc
            errs = collectionErrors col
            nFuns = sum [M.size (ccFuns c) + maybe 0 (const 1) (ccConstructor c) | c <- M.elems (colContracts col)]
            nBad = length [() | (_, e) <- errs, eKind e /= Internal] -- storage errors counted too
        printf "%s: %d contracts, %d functions, %d errors\n" f (M.size (colContracts col)) nFuns (length errs)
        forM_ (M.toList (CC._contracts cc)) $ \(name, contract) -> do
          let duplicateArities f' =
                let arities = map (length . CC._funcArgs) (f' : CC._funcOverload f')
                 in length arities /= M.size (M.fromList [(arity, ()) | arity <- arities])
              supported = not (any duplicateArities (M.elems (CC._functions contract)))
                && either (const False) (const True) (compileContractChecked cc contract)
          printf "    WHOLE %s %s\n" (T.unpack name) (if supported then "supported" else "rejected" :: String)
        forM_ errs $ \(w, e) -> T.putStrLn ("    " <> w <> " -> " <> showErr e)
        forM_ errs $ \(_, e) -> modifyIORef' summary (M.insertWith (+) (T.pack (show (eKind e)) <> ": " <> headline (eMsg e)) 1)
        modifyIORef' totals (\(a, b, c, d) -> (a + 1, b, c + nFuns - nBad, d + nBad))
  (a, b, c, d) <- readIORef totals
  printf "\nTOTAL collections %d (parse failures %d), functions compiled %d, failed %d\n" a b c d
  putStrLn "By reason:"
  s <- readIORef summary
  forM_ (sortOn (negate . snd) (M.toList s)) $ \(k, n) -> printf "%6d  %s\n" n (T.unpack k)
  where
    headline m = T.takeWhile (/= ':') (T.takeWhile (/= '(') m)

-- ---------------------------------------------------------------- mock runtime for the fee chain

data World = World
  { wStorage :: IORef (M.Map (Address, StoragePath) BasicValue)
  , wCode :: M.Map Address (T.Text, CompiledCollection)     -- contract name + collection at each address
  , wEvents :: IORef [T.Text]
  , wCalls :: IORef Int
  }

mkRT :: World -> RT
mkRT w = RT
  { rtChargeGas = \_ -> pure ()
  , rtGet = \a p -> M.findWithDefault BDefault (a, p) <$> readIORef (wStorage w)
  , rtPut = \a p v -> modifyIORef' (wStorage w) (if isDefault v then M.delete (a, p) else M.insert (a, p) v)
  , rtEmit = \fr cn en args -> modifyIORef' (wEvents w) (++ [T.pack (show (fThis fr)) <> " " <> cn <> "." <> en <> "(" <> T.intercalate ", " [n <> "=" <> showDyn d | (n, d) <- args] <> ")"])
  , rtCall = \kind caller addr name args _ -> dispatch w kind caller addr name args
  , rtBuiltin = \name _ -> throwIO (Divergence ("builtin requires the STRATO runtime: " <> name))
  , rtSender = pure . fSender
  , rtCreate = \_ _ _ _ -> throwIO (Divergence "contract creation requires the STRATO runtime")
  , rtBlockNumber = 1
  , rtTimestamp = 0
  }

-- Call boundary: EVM semantics -- a reverting callee rolls back its own writes.
dispatch :: World -> CallKind -> Frame -> Address -> T.Text -> [Dyn] -> IO [Dyn]
dispatch w kind caller target fn args = do
  let codeAddr = if kind == Call && target == fThis caller then fCode caller else target
  modifyIORef' wCalls' (+ 1)
  (cn, col) <- maybe (throwIO (Revert ("no code at " <> T.pack (show codeAddr)))) pure (M.lookup codeAddr (wCode w))
  cc <- maybe (throwIO (Divergence ("contract " <> cn <> " missing in collection"))) pure (M.lookup cn (colContracts col))
  let fr = case kind of
        Call | target == fThis caller -> caller { fSig = fn, fArgs = args }
        DelegateCall -> caller { fCode = codeAddr, fSig = fn, fArgs = args }
        _ -> Frame { fThis = codeAddr, fCode = codeAddr, fSender = fThis caller, fOrigin = fOrigin caller, fSig = fn, fArgs = args, fValue = 0 }
      key = fn <> "/" <> T.pack (show (length args))
  (sigFun, args') <- case M.lookup key (ccFuns cc) of
    Just ef -> pure (ef, args)
    Nothing -> case M.lookup "fallback/1" (ccFuns cc) of
      Just ef -> pure (ef, [Dyn TVariadic args])
      Nothing -> throwIO (Revert ("no function " <> cn <> "." <> key <> " and no fallback"))
  Fun _ sig f <- either (throwIO . Divergence . showErr) pure sigFun
  snapshot <- readIORef (wStorage w)
  evs <- readIORef (wEvents w)
  r <- try (runReaderT (callDyn sig f args') (mkRT w, fr))
  case r of
    Right out -> pure out
    Left (e :: Revert) -> do writeIORef (wStorage w) snapshot; writeIORef (wEvents w) evs; throwIO e
  where wCalls' = wCalls w

feeChain :: FilePath -> IO ()
feeChain codeDir = do
  let load f = do src <- loadSource (codeDir </> f); either (\e -> fail ("parse " ++ f ++ ": " ++ e)) (pure . compileCollection) (parseCC src)
  decider <- load "Decide.sol"
  dstate <- load "DeciderState.sol"
  mercata <- load "21137d33.json"
  forM_ [("Decide", decider), ("DeciderState", dstate), ("mercata", mercata)] $ \(n, col) -> do
    let errs = collectionErrors col
    printf "%s: %d functions, %d compile errors\n" (n :: String) (sum [M.size (ccFuns c) | c <- M.elems (colContracts col)]) (length errs)
    forM_ [e | e@(w, _) <- errs, any (`T.isPrefixOf` w) ["Decider", "DeciderState", "Proxy", "Voucher", "Token.", "ERC20", "Ownable", "Pausable", "Context"]] $ \(w, e) -> T.putStrLn ("    " <> w <> " -> " <> showErr e)
  let voucher = Address 0x100e; usdst = Address 0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010
      voucherLogic = Address 0x110e; tokenLogic = Address 0x110f
      sender = Address 0xabc
      code = M.fromList
        [ (Address 0xDEC1DE, ("Decider", decider)), (Address 0xDEC1DE02, ("DeciderState", dstate))
        , (voucher, ("Proxy", mercata)), (usdst, ("Proxy", mercata))
        , (voucherLogic, ("Voucher", mercata)), (tokenLogic, ("Token", mercata)) ]
      field n = StoragePath [Field (TE.encodeUtf8 n)]
      bal a = StoragePath [Field "_balances", Index (TE.encodeUtf8 (T.pack (show a)))]
      initial = M.fromList
        [ ((Address 0xDEC1DE02, field "currentFeeContract"), BAddress (Address 0xDEC1DE02))
        , ((voucher, field "logicContract"), BAddress voucherLogic)
        , ((usdst, field "logicContract"), BAddress tokenLogic)
        , ((voucher, bal sender), BInteger (3 * 10 ^ (18 :: Int)))
        , ((voucher, field "_totalSupply"), BInteger (10 * 10 ^ (18 :: Int)))
        , ((usdst, bal sender), BInteger (5 * 10 ^ (16 :: Int))) ]
  st <- newIORef initial
  evs <- newIORef []
  calls <- newIORef 0
  let w = World st code evs calls
      topFrame = Frame { fThis = sender, fCode = Address 0xDEC1DE, fSender = sender, fOrigin = sender, fSig = "decide", fArgs = [], fValue = 0 }
      -- payFees in BlockChain.hs: SolidVM.call ... 0xDEC1DE ... "decide" [] (Just DelegateCall), so `this` = tx sender
      runDecide = dispatch w DelegateCall topFrame { fThis = sender } (Address 0xDEC1DE) "decide" []
      dump label = do
        m <- readIORef st
        es <- readIORef evs
        n <- readIORef calls
        printf "-- %s: calls=%d\n" (label :: String) n
        forM_ (M.toList m) $ \((a, p), v) -> when (a `elem` [voucher, usdst]) $ printf "   %s %s = %s\n" (show a) (show p) (show v)
        forM_ es $ \e -> T.putStrLn ("   event " <> e)
        writeIORef evs []
  dump "initial state"
  forM_ [1 :: Int .. 5] $ \i -> do
    r <- try runDecide
    case r of
      Right out -> printf "decide #%d -> %s\n" i (T.unpack (T.intercalate "," (map showDyn out)))
      Left (e :: SomeException) -> printf "decide #%d -> EXCEPTION %s\n" i (show e)
    dump ("after decide #" ++ show i)

main :: IO ()
main = getArgs >>= \case
  ["census", dir] -> census dir
  ["feechain", dir] -> feeChain dir
  _ -> putStrLn "usage: svmc census <dir> | svmc feechain <dir>"
