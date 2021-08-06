{-# LANGUAGE ConstraintKinds   #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeOperators     #-}

module Blockchain.Privacy.Event
  ( HasPrivacyRegistries
  , HasFullPrivacy
  , lookupSeenChain
  , insertTransaction
  , findChainHashUses
  , lookupChainIdFromChainHash
  , useChainHash
  , getChainBuffer , lookupChainBuffer
  , insertChainBufferEntry
  , getNewChainHash
  , checkIfIsMissingTX
  , runPrivateHashTX
  , runBlocks
  , hasAllAncestorChains
  , hydratePrivateHashes
  , insertNewChainInfo
  , isPrivateHashTX
  , isPrivateChainTX
  ) where

import           Blockchain.Data.ChainInfo
import           Blockchain.Data.TransactionDef (formatChainId)
import           Blockchain.ExtWord
import           Blockchain.Output
import           Blockchain.Privacy.Monad
import           Blockchain.Privacy.Metrics
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Class
import           Control.Lens
import           Control.Monad
import           Control.Monad.Change.Alter
import           Data.Bool                     (bool)
import           Data.Foldable                 (foldrM, for_)
import           Data.Maybe
import qualified Data.Set                      as S
import qualified Data.Sequence                 as Q
import           Data.String
import           Data.Text                     (Text)
import qualified Data.Text                     as T
import           Data.Traversable
import           Prelude                       hiding (lookup)
import           Prometheus
import qualified Text.Colors                   as CL
import           Text.Format

type HasPrivacyRegistries m = ( (Keccak256 `Alters` OutputBlock) m
                              , (Keccak256 `Alters` EmittedBlock) m
                              , (Keccak256 `Alters` OutputTx) m
                              , (Keccak256 `Alters` ChainHashEntry) m
                              , (Word256 `Alters` ChainIdEntry) m
                              , Selectable (Maybe Word256) ParentChainId m
                              )

type HasFullPrivacy m = ( HasPrivacyRegistries m
                        , HasPrivateHashDB m
                        )

logFF :: MonadLogger m => Text -> String -> m ()
logFF str = $logInfoS str . T.pack

lookupSeenChain :: (Word256 `Alters` ChainIdEntry) m => Word256 -> m Bool
lookupSeenChain chainId = isJust . join . fmap _chainIdInfo <$> lookup (Proxy @ChainIdEntry) chainId

insertTransaction :: (MonadLogger m, (Keccak256 `Alters` OutputTx) m) => OutputTx -> m ()
insertTransaction otx = do
  let tHash = txHash $ otBaseTx otx
  logFF "insertTransaction" $ "Inserting transaction " ++ format tHash
  insert (Proxy @OutputTx) tHash otx

findChainHashUses :: ( MonadLogger m
                     , (Keccak256 `Alters` ChainHashEntry) m
                     , (Word256 `Alters` ChainIdEntry) m
                     )
                  => Word256 -> [Keccak256] -> m ()
findChainHashUses chainId cHashes = do
  infos <- S.unions
          . map (maybe S.empty _inBlocks)
        <$> mapM (lookup (Proxy @ChainHashEntry)) cHashes
  logFF "Privacy/findChainHashUses" $ "blocksToRun unioning infos " ++ show infos
  adjustStatefully_ (Proxy @ChainIdEntry) chainId $ blocksToRun %= S.union infos

insertPrivateHash :: ( MonadLogger m
                     , MonadMonitor m
                     , (Keccak256 `Alters` ChainHashEntry) m
                     , (Word256 `Alters` ChainIdEntry) m
                     )
                  => BlockInfo -> OutputTx -> m ()
insertPrivateHash bInfo tx = case txChainId tx of
  Nothing -> do
    logFF "insertPrivateHash" $ "Trying to insert the public transaction " ++ show (txHash tx)
    return ()
  Just chainId -> do
    withLabel txMetrics "private_hash" incCounter
    let cHashes = generateChainHashes tx
    cHashes' <- fmap catMaybes . forM cHashes $ \cHash -> do
      didInsert <- insertChainHash bInfo cHash chainId
      case didInsert of
        Inserted -> do
          logFF "insertPrivateHash" $ concat
            [ " Successfully inserted chain hash "
            , format cHash
            , " for chain ID "
            , formatChainId $ Just chainId
            ]
          return $ Just cHash
        AlreadyExistsOnSameChain -> do
          logFF "insertPrivateHash" $ concat
            [ "Chain hash "
            , format cHash
            , " for chain ID "
            , formatChainId $ Just chainId
            , " has been previously inserted for the same chain ID."
            , " Not reinserting."
            ]
          return Nothing
        SeenPreviouslyOnUnknownChain bi -> do
          $logErrorS "insertPrivateHash" . T.pack $ concat
            [ "Chain hash "
            , format cHash
            , " has been seen previous to block "
            , format bInfo
            , " in block "
            , format bi
            , ". This is most likely a bug in the STRATO platform."
            , " Please file this as an issue at https://github.com/blockapps/strato-getting-started/"
            ]
          return Nothing
        WrongChainId cid -> do
          $logErrorS "insertPrivateHash" . T.pack $ concat
            [ "Initial chain hash of chain ID "
            , formatChainId $ Just chainId
            , " was previously associated with a different chain, "
            , formatChainId $ Just cid
            , ". This is most likely a bug in the STRATO platform."
            , " Please file this as an issue at https://github.com/blockapps/strato-getting-started/"
            ]
          return Nothing
    mapM_ (insertChainBufferEntry chainId) cHashes'
    logFF "insertPrivateHash" $ "findChainHashUses for chainId: " ++ format chainId ++ ", and cHashes': " ++ format cHashes'
    findChainHashUses chainId cHashes'

lookupChainIdFromChainHash :: (Keccak256 `Alters` ChainHashEntry) m => Keccak256 -> m (Maybe Word256)
lookupChainIdFromChainHash ch = join . fmap _onChainId <$> lookup (Proxy @ChainHashEntry) ch

data InsertChainHashResult = Inserted
                           | AlreadyExistsOnSameChain
                           | SeenPreviouslyOnUnknownChain BlockInfo
                           | WrongChainId Word256

insertChainHash :: (Keccak256 `Alters` ChainHashEntry) m
                => BlockInfo
                -> Keccak256
                -> Word256
                -> m InsertChainHashResult
insertChainHash obi cHash chainId = lookup Proxy cHash >>= \case
  Nothing -> Inserted <$ insert Proxy cHash (chainHashEntryWithChainId chainId)
  Just ChainHashEntry{..} -> case _onChainId of
    Just cid -> if cid == chainId
                  then return AlreadyExistsOnSameChain
                  else return $ WrongChainId cid
    Nothing -> case S.lookupMin _inBlocks of
      Just bi | bi <= obi -> return $ SeenPreviouslyOnUnknownChain bi
      _ -> Inserted <$ adjustStatefully_ Proxy cHash (onChainId .= Just chainId)

useChainHash :: (Keccak256 `Alters` ChainHashEntry) m => Keccak256 -> m ()
useChainHash cHash = adjustWithDefaultStatefully_ Proxy cHash $ used .= True

getChainBuffer :: (Word256 `Alters` ChainIdEntry) m => Word256 -> m (CircularBuffer Keccak256)
getChainBuffer chainId = maybe emptyCircularBuffer _chainHashes <$> lookup Proxy chainId

lookupChainBuffer :: (Word256 `Alters` ChainIdEntry) m => Word256 -> m (CircularBuffer Keccak256)
lookupChainBuffer = getChainBuffer

insertChainBufferEntry :: ( MonadMonitor m
                          , (Word256 `Alters` ChainIdEntry) m
                          )
                       => Word256 -> Keccak256 -> m ()
insertChainBufferEntry chainId cHash = adjustStatefully_ Proxy chainId $ do
  CircularBuffer cap sz q <- use chainHashes
  withLabel chainBuffer (fromString (show chainId)) (flip setGauge (fromIntegral sz))
  if sz < cap
    then chainHashes .= CircularBuffer cap (sz + 1) (q Q.|> cHash)
    else case Q.viewl q of
           Q.EmptyL -> chainHashes .= CircularBuffer cap 1 (q Q.|> cHash)
           (_ Q.:< q') -> chainHashes .= CircularBuffer cap sz (q' Q.|> cHash)

getNewChainHash :: ( MonadLogger m
                   , HasPrivateHashDB m
                   , (Keccak256 `Alters` ChainHashEntry) m
                   , (Word256 `Alters` ChainIdEntry) m
                   )
                => Word256 -> m (Maybe Keccak256)
getNewChainHash chainId = do
  CircularBuffer cap sz q <- getChainBuffer chainId
  case Q.viewl q of
    Q.EmptyL -> do
      logFF "getNewChainHash" $ "Empty chain buffer for chainId " ++ CL.yellow (format chainId)
      join . fmap (fmap generateInitialChainHash . _chainIdInfo) <$> lookup (Proxy @ChainIdEntry) chainId
    (h Q.:< q') -> do
      adjustStatefully_ (Proxy @ChainIdEntry) chainId $
        chainHashes .= CircularBuffer cap (sz - 1) q'
      used' <- _used <$> lookupWithDefault (Proxy @ChainHashEntry) h
      if not used'
        then useChainHash h >> return (Just h)
        else getNewChainHash chainId

checkIfIsMissingTX :: ( MonadLogger m
                      , HasPrivateHashDB m
                      , (Keccak256 `Alters` ChainHashEntry) m
                      )
                   => Keccak256 -> Keccak256 -> m ()
checkIfIsMissingTX th ch = do
  let logF = logFF "checkIfIsMissingTX"
  mChainId <- join . fmap _onChainId <$> lookup Proxy ch
  case mChainId of
    Nothing -> do
      logF "We don't know this transaction's chain Id. Oh well..."
    Just chainId -> do
      logF . concat $
        [ "We know this transaction's chain Id. It's "
        , CL.yellow $ format chainId
        , ". Requesting transaction from peers"
        ]
      requestTransaction th

runPrivateHashTX :: ( MonadLogger m
                    , HasPrivateHashDB m
                    , (Keccak256 `Alters` ChainHashEntry) m
                    )
                 => Keccak256 -> Keccak256 -> m ()
runPrivateHashTX tHash cHash = do
  let logF = logFF "runPrivateHashTX"
  logF . concat $
    [ "Transforming transaction "
    , format tHash
    , " with chain hash "
    , format cHash
    ]
  useChainHash cHash
  checkIfIsMissingTX tHash cHash

getAllBlocksToRun :: (Word256 `Alters` ChainIdEntry) m
                  => Word256 -> m (S.Set BlockInfo)
getAllBlocksToRun = fmap S.unions . traverseAncestorChains (fmap (maybe S.empty _blocksToRun) . lookup (Proxy @ChainIdEntry))

runBlocks :: ( MonadLogger m
             , MonadMonitor m
             , HasFullPrivacy m
             )
          => Word256 -> m [OutputBlock]
runBlocks chainId = go Nothing
  where
    go mPreviousBlock = do
      btr <- getAllBlocksToRun chainId
      if S.null btr
        then return []
        else do
          let b0 = S.elemAt 0 btr
          if Just b0 == mPreviousBlock
            then do
              $logWarnS "Privacy/runBlocks" . T.pack $ concat
                [ "Failed to clear previous block from cache: "
                , format b0
                , ". Breaking to prevent infinite loop."
                , " This probably means this node was removed from the private chain "
                , format chainId
                , "."
                ]
              pure []
            else do
              mBlock <- lookup (Proxy @OutputBlock) (_bhash b0)
              fmap (fromMaybe [] . join) . for mBlock $ \block -> do
                mHydrated <- hydratePrivateHashes (Just chainId) block
                for mHydrated $ \b -> do
                  logFF "Privacy/runBlocks" $ concat
                    [ "blocksToRun deleting "
                    , format b0
                    , " for private chain "
                    , format chainId
                    , " and its ancestors."
                    ]
                  let chainIds = S.toList
                               . (S.\\ (S.singleton Nothing))
                               . S.fromList
                               . (Just chainId :) -- It's possible that there aren't any transactions with this chainId in the block
                               $ txChainId <$> obReceiptTransactions b
                  for_ chainIds $ \(Just cId) -> forAncestorChains cId . flip (adjustStatefully_ (Proxy @ChainIdEntry)) $
                    blocksToRun %= S.delete b0
                  (b:) <$> go (Just b0)

hasAllAncestorChains :: (Word256 `Alters` ChainIdEntry) m
                     => Maybe Word256 -> m Bool
hasAllAncestorChains = go
  where
    go Nothing = pure True
    go (Just chainId) = do
      mmParent <- join . fmap (fmap (parentChain . chainInfo) . _chainIdInfo) <$> lookup (Proxy @ChainIdEntry) chainId
      maybe (pure False) go mmParent

traverseAncestorChains :: (Word256 `Alters` ChainIdEntry) m
                       => (Word256 -> m a) -> Word256 -> m [a]
traverseAncestorChains action cId = go (Just cId)
  where
    go Nothing = pure []
    go (Just chainId) = do
      a <- action chainId
      mmParent <- join . join . fmap (fmap (parentChain . chainInfo) . _chainIdInfo) <$> lookup (Proxy @ChainIdEntry) chainId
      (a:) <$> go mmParent

forAncestorChains :: (Word256 `Alters` ChainIdEntry) m
                  => Word256 -> (Word256 -> m a) -> m [a]
forAncestorChains = flip traverseAncestorChains

accumT :: Monad m => s -> [a] -> (s -> a -> m (b,s)) -> m ([b],s)
accumT s [] _ = pure ([],s)
accumT s (a:as) run = do
  (b,s') <- run s a
  (bs,s'') <- accumT s' as run
  return (b:bs,s'')

hydratePrivateHashes :: ( MonadLogger m
                        , MonadMonitor m
                        , HasFullPrivacy m
                        )
                     => Maybe Word256
                     -> OutputBlock
                     -> m (Maybe OutputBlock)
hydratePrivateHashes chainF b = do
  let logF = logFF "hydratePrivateHashes"
      bHash = blockHeaderHash $ blockHeader b
      bOrdering = blockOrdering b
      bInfo = BlockInfo bHash bOrdering
  when (any isPrivateHashTX $ blockTransactions b) $
    insert (Proxy @OutputBlock) bHash b
  let discluded cs cid = foldrM (\x y -> if y then pure y else x `isAncestorChainOf` cid) False (S.elems cs)
      txs = blockTransactions b
  (txs', (depTXs,newDiscludes)) <- accumT ([],S.empty) txs $ \st@(dts,cs) tx -> do
    let tHash = txHash tx
        notHydrating msg = logF . concat $
          [ "Not hydrating transaction "
          , format tHash
          , " because "
          , msg
          ]
    if not $ isPrivateHashTX tx
      then do
      notHydrating "it's not a private hash transaction"
      return (tx, st)
      else do
        let cHash = txChainHash tx
        runPrivateHashTX tHash cHash
        adjustWithDefaultStatefully_ (Proxy @ChainHashEntry) cHash $
          inBlocks %= (S.insert $ BlockInfo bHash bOrdering)
        chainId <- join . fmap _onChainId <$> lookup (Proxy @ChainHashEntry) cHash
        case chainId of
          Nothing -> do
            notHydrating "we don't know the chain ID"
            return (tx, st)
          Just cId -> do
            isDiscluded <- discluded cs chainId
            if isDiscluded
              then do
                notHydrating "its chain ID is discluded from this hydration round"
                return (tx, st)
              else lookup (Proxy @ChainIdEntry) cId >>= \case
                Nothing -> do
                  notHydrating "we don't have the info for its chain"
                  return (tx, st)
                Just ChainIdEntry{..} -> do
                  allBlocksToRun <- getAllBlocksToRun cId
                  if not (S.null allBlocksToRun || (_bhash $ S.elemAt 0 allBlocksToRun) == bHash)
                    then do
                      notHydrating "this is not the chain's next block to run"
                      logF $ "If blocksToRun is null: " ++ show (S.null allBlocksToRun) ++ " Next block to run is: "++ format (_bhash $ S.elemAt 0 allBlocksToRun)
                      logF $ "All the blocksToRun: " ++ show allBlocksToRun
                      logF $ "bHash of this tx: " ++ show bHash
                      when (isNothing chainF) . void . forAncestorChains cId $ \ancestorChainId -> do
                        adjustStatefully_ (Proxy @ChainIdEntry) ancestorChainId $
                          --logF $ "blocksToRun inserting " ++ format bHash
                          blocksToRun %= S.insert (BlockInfo bHash (blockOrdering b))
                      return (tx, (dts,S.insert chainId cs))
                    else do
                      lookup (Proxy @OutputTx) tHash >>= \case
                        Nothing -> do
                          notHydrating "we don't have this transaction's body"
                          when (isNothing chainF)
                            . adjustStatefully_ (Proxy @ChainIdEntry) cId $ do
                              -- logF $ "blocksToRun inserting " ++ format bHash
                              blocksToRun %= S.insert (BlockInfo bHash (blockOrdering b))
                          return (tx, (tHash:dts, S.insert chainId cs))
                        Just ptx -> do
                          logF $ "Transaction hash " ++ format tHash ++ " is not missing. Hydrating!"
                          if chainId == txChainId ptx
                            then do
                              insertPrivateHash bInfo ptx
                            else do
                              logF $ concat
                                [ "Transaction hash "
                                , format tHash
                                , " is not missing,"
                                , " but it's chain ID does not match"
                                , " that of its chain hash entry."
                                , " Not inserting chain hashes,"
                                , " but still sending transaction to the VM,"
                                , " where it will fail."
                                ]
                          let ptx' = ptx{otAnchorChain = AnchoredPrivate cId}
                          return (ptx', st)

  -- we have to filter out lingering transactions that weren't initially discluded,
  -- but were discluded by a subsequent missing transcation
  let anchorToChain = fromAnchorChain . otAnchorChain
  txs'' <- for (zip txs txs') $ \(tx,tx') -> bool tx' tx <$> discluded newDiscludes (anchorToChain tx')

  unless (null depTXs) $ do
    logF . concat $
      [ "Block hash "
      , format bHash
      , " has dependent transactions.\n"
      , show (map format depTXs)
      , " Inserting them into GetTransactions list"
      ]
    mapM_ requestTransaction depTXs
  included <- not <$> discluded newDiscludes chainF
  if included
    then do
      let b' = b{obReceiptTransactions = txs''}
      adjust_ (Proxy @OutputBlock) bHash $ pure . const b' -- not insert, in case it wasn't there to begin with
      pure $ Just b'
    else pure Nothing

insertNewChainInfo :: ( MonadLogger m
                      , MonadMonitor m
                      , HasFullPrivacy m
                      )
                   => Word256
                   -> ChainInfo
                   -> m [OutputBlock]
insertNewChainInfo chainId cInfo = do
  let cHash = generateInitialChainHash cInfo
  repsert_ Proxy chainId $ return . maybe (chainIdEntry cInfo) (chainIdInfo .~ Just cInfo)
  withLabel chainMetrics "seen_chains" incCounter
  let bHash = creationBlock $ chainInfo cInfo
  bInfo <- BlockInfo bHash . maybe 0 blockOrdering <$> lookup (Proxy @OutputBlock) bHash
  insertChainHash bInfo cHash chainId >>= \case
    Inserted -> do
      insertChainBufferEntry chainId cHash
      logFF "insertNewChainInfo" $ "findChainHashUses for chainId: " ++ format chainId ++ ", and cHash: " ++ format cHash
      findChainHashUses chainId [cHash]
      runBlocks chainId
    AlreadyExistsOnSameChain -> do
      logFF "insertNewChainInfo" $ concat
        [ "Initial chain hash "
        , format cHash
        , " of chain ID "
        , formatChainId $ Just chainId
        , " has been previously inserted for the same chain ID."
        , " Not reinserting."
        ]
      return []
    SeenPreviouslyOnUnknownChain bi -> do
      $logErrorS "insertNewChainInfo" . T.pack $ concat
        [ "Initial chain hash of chain ID "
        , formatChainId $ Just chainId
        , " found before chain's creation block "
        , format bInfo
        , " in block "
        , format bi
        , ". This is most likely a bug in the STRATO platform."
        , " Please file this as an issue at https://github.com/blockapps/strato-getting-started/"
        ]
      return []
    WrongChainId cid -> do
      $logErrorS "insertNewChainInfo" . T.pack $ concat
        [ "Initial chain hash of chain ID "
        , formatChainId $ Just chainId
        , " was previously associated with a different chain, "
        , formatChainId $ Just cid
        , ". This is most likely a bug in the STRATO platform."
        , " Please file this as an issue at https://github.com/blockapps/strato-getting-started/"
        ]
      return []

isPrivateHashTX :: TransactionLike t => t -> Bool
isPrivateHashTX = (== PrivateHash) . txType

isPrivateChainTX :: TransactionLike t => t -> Bool
isPrivateChainTX = isJust . txChainId
