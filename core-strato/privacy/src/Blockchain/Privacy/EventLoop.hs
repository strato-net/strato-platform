{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.Privacy.Event
  ( lookupSeenChain
  , insertSeenChain
  , insertTransaction
  , findChainHashUses
  , insertPrivateHash
  , insertChainHash
  , useChainHash
  , getChainBuffer
  , lookupChainBuffer
  , insertChainBufferEntry
  , getNewChainHash
  , insertChainInfo
  , checkIfIsMissingTX
  , runPrivateHashTX
  , runBlocks
  , hydratePrivateHashes
  , insertNewChainInfo
  , isPrivateHashTX
  , isPrivateChainTX
  ) where

import           Blockchain.Data.ChainInfo
import           Blockchain.ExtWord
import           Blockchain.Format
import           Blockchain.Privacy.DB
import           Blockchain.Privacy.Metrics
import           Blockchain.SHA
import           Blockchain.Strato.Model.Class
import           Control.Arrow                 ((&&&))
import           Control.Lens
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Data.Foldable                 (for_, toList)
import           Data.Maybe
import qualified Data.Set                      as S
import qualified Data.Sequence                 as Q
import           Data.String
import           Data.Text                     (Text)
import qualified Data.Text                     as T
import           Data.Traversable
import           Prometheus

logFF :: MonadLogger m => Text -> String -> m ()
logFF str = $logInfoS str . T.pack

lookupSeenChain :: HasPrivateHashDB h t b m => Word256 -> m Bool
lookupSeenChain chainId = isJust <$> getChainIdEntry chainId

insertSeenChain :: HasPrivateHashDB h t b m => Word256 -> ChainInfo -> m ()
insertSeenChain chainId cInfo = do
  liftIO $ withLabel chainMetrics "seen_chains" incCounter
  repsertChainIdEntry_ chainId $ return . maybe (chainIdEntry cInfo) (chainIdInfo .~ cInfo)

insertTransaction :: HasPrivateHashDB h t b m => t -> m ()
insertTransaction = uncurry insertTxHashEntry . (txHash &&& id)

findChainHashUses :: HasPrivateHashDB h t b m => Word256 -> [SHA] -> m ()
findChainHashUses chainId cHashes = do
  blocks <- toList
          . S.fromList
          . concat
          . map (toList . maybe Q.empty _inBlocks)
        <$> mapM getChainHashEntry cHashes
  bOrders <- map (fmap blockOrdering) <$> mapM getBlockHashEntry blocks
  let infos = S.fromList . catMaybes $ zipWith (\b -> fmap (BlockInfo b)) blocks bOrders
  modifyChainIdEntryState_ chainId $ blocksToRun %= S.union infos

insertPrivateHash :: HasPrivateHashDB h t b m => t -> m ()
insertPrivateHash tx = case txChainId tx of
  Nothing -> error "insertPrivateHash: Trying to insert a public transaction"
  Just chainId -> do
    liftIO $ withLabel txMetrics "private_hash" incCounter
    cHashes <- generateChainHashes tx
    mapM_ (flip insertChainHash chainId) cHashes
    mapM_ (insertChainBufferEntry chainId) cHashes
    findChainHashUses chainId cHashes

insertChainHash :: HasPrivateHashDB h t b m => SHA -> Word256 -> m ()
insertChainHash cHash chainId = repsertChainHashEntry_ cHash $ \case
  Nothing -> return $ chainHashEntryWithChainId chainId
  Just che -> return $ (onChainId .~ Just chainId) che

useChainHash :: HasPrivateHashDB h t b m => SHA -> m ()
useChainHash cHash = modifyChainHashEntryState_ cHash $ used .= True

getChainBuffer :: HasPrivateHashDB h t b m => Word256 -> m (CircularBuffer SHA)
getChainBuffer chainId = maybe emptyCircularBuffer _chainHashes <$> getChainIdEntry chainId

lookupChainBuffer :: HasPrivateHashDB h t b m => Word256 -> m (CircularBuffer SHA)
lookupChainBuffer = getChainBuffer

insertChainBufferEntry :: HasPrivateHashDB h t b m => Word256 -> SHA -> m ()
insertChainBufferEntry chainId cHash = modifyChainIdEntryState_ chainId $ do
  CircularBuffer cap sz q <- use chainHashes
  liftIO $ withLabel chainBuffer (fromString (show chainId)) (flip setGauge (fromIntegral sz))
  if sz < cap
    then chainHashes .= CircularBuffer cap (sz + 1) (q Q.|> cHash)
    else case Q.viewl q of
           Q.EmptyL -> chainHashes .= CircularBuffer cap 1 (q Q.|> cHash)
           (_ Q.:< q') -> chainHashes .= CircularBuffer cap sz (q' Q.|> cHash)

getNewChainHash :: HasPrivateHashDB h t b m => Word256 -> m SHA
getNewChainHash chainId = do
  CircularBuffer cap sz q <- getChainBuffer chainId
  case Q.viewl q of
    Q.EmptyL -> error $ "getNewChainHash: Empty chain buffer for chainId " ++ show chainId
    (h Q.:< q') -> do
      modifyChainIdEntryState_ chainId $ chainHashes .= CircularBuffer cap (sz - 1) q'
      Just used' <- fmap _used <$> getChainHashEntry h
      if not used'
        then useChainHash h >> return h
        else getNewChainHash chainId

insertChainInfo :: HasPrivateHashDB h t b m => Word256 -> ChainInfo -> m ()
insertChainInfo chainId cInfo = do
  h <- generateInitialChainHash cInfo
  insertSeenChain chainId cInfo
  insertChainHash h chainId
  insertChainBufferEntry chainId h

checkIfIsMissingTX :: HasPrivateHashDB h t b m => SHA -> SHA -> m ()
checkIfIsMissingTX th ch = do
  let logF = logFF "runPrivateHashTX"
  mChainId <- join . fmap _onChainId <$> getChainHashEntry ch
  case mChainId of
    Nothing -> do
      logF "We don't know this transaction's chain Id. Oh well..."
      return ()
    Just chainId -> do
      logF . concat $
        [ "We know this transaction's chain Id. It's "
        , format (SHA chainId)
        , ". Inserting into MissingTxDB and GetTransactions list"
        ]
      useChainHash ch
      requestTransaction th

runPrivateHashTX :: HasPrivateHashDB h t b m => SHA -> SHA -> m ()
runPrivateHashTX tHash cHash = do
  let logF = logFF "runPrivateHashTX"
  logF . concat $
    [ "Transforming transaction "
    , format tHash
    , " with chain hash "
    , format cHash
    ]
  mthe <- getTxHashEntry tHash
  for_ mthe . const $ repsertChainHashEntry_ cHash $
    return . maybe chainHashEntryUsed (used .~ True)
  checkIfIsMissingTX tHash cHash

runBlocks :: HasPrivateHashDB h t b m => Word256 -> m [b]
runBlocks chainId = go
  where
    go = do
      btr <- maybe S.empty _blocksToRun <$> getChainIdEntry chainId
      if S.null btr
        then return []
        else do
          let b0 = S.elemAt 0 btr
          mBlock <- getBlockHashEntry (_bhash b0)
          fmap (fromMaybe [] . join) . for mBlock $ \block -> do
            mHydrated <- hydratePrivateHashes (Just chainId) block
            for mHydrated $ \b -> do
              modifyChainIdEntryState_ chainId $ blocksToRun %= S.delete b0
              (b:) <$> go

accumT :: Monad m => s -> [a] -> (s -> a -> m (b,s)) -> m ([b],s)
accumT s [] _ = pure ([],s)
accumT s (a:as) run = do
  (b,s') <- run s a
  (bs,s'') <- accumT s' as run
  return (b:bs,s'')

hydratePrivateHashes :: HasPrivateHashDB h t b m
                     => Maybe Word256
                     -> b
                     -> m (Maybe b)
hydratePrivateHashes chainF b = do
  let logF = logFF "hydratePrivateHashes"
      bHash = blockHeaderHash $ blockHeader b
  insertBlockHashEntry bHash b
  let discluded cId = maybe False (/= cId) chainF
  (txs', (depTXs,newDiscludes)) <- accumT ([],S.empty) (blockTransactions b) $ \st@(dts,cs) tx -> do
    let tHash = txHash tx
        notHydrating msg = logF . concat $
          [ "Not hydrating transaction "
          , format tHash
          , " because "
          , msg
          ]
    if not $ isPrivateHashTX tx
      then do
      notHydrating "it's not a private transaction"
      return (Nothing, st)
      else do
        let cHash = txChainHash tx
        runPrivateHashTX tHash cHash
        repsertChainHashEntry_ cHash $
          return . maybe
            (chainHashEntryInBlock bHash)
            (inBlocks %~ (Q.|> bHash))
        mChainId <- join . fmap _onChainId <$> getChainHashEntry cHash
        case mChainId of
          Nothing -> do
            notHydrating "we don't know the chain ID"
            return (Nothing, st)
          Just chainId -> if discluded chainId || S.member chainId cs
            then do
              notHydrating "its chain ID is discluded from this hydration round"
              return (Nothing, st)
            else getChainIdEntry chainId >>= \case
              Nothing -> do
                notHydrating "we don't have the info for its chain"
                return (Nothing, st)
              Just ChainIdEntry{..} -> do
                if not (S.null _blocksToRun || (_bhash $ S.elemAt 0 _blocksToRun) == bHash)
                  then do
                    notHydrating "this is not the chain's next block to run"
                    modifyChainIdEntryState_ chainId $
                      when (isNothing chainF) $
                        blocksToRun %= S.insert (BlockInfo bHash (blockOrdering b))
                    return (Nothing, (dts,S.insert chainId cs))
                  else do
                    getTxHashEntry tHash >>= \case
                      Nothing -> do
                        notHydrating "we don't have this transaction's body"
                        modifyChainIdEntryState_ chainId $ do
                          when (isNothing chainF) $
                            blocksToRun %= S.insert (BlockInfo bHash (blockOrdering b))
                        return (Nothing, (tHash:dts, S.insert chainId cs))
                      Just ptx -> do
                        logF $ "Transaction hash " ++ format tHash ++ " is not missing. Hydrating!"
                        insertPrivateHash ptx
                        return (Just ptx, st)

  -- we have to filter out lingering transactions that weren't initially discluded,
  -- but were discluded by a subsequent missing transcation
  let txs'' = filter (\otx -> not (discluded (fromJust $ txChainId otx)
                     || S.member (fromJust $ txChainId otx) newDiscludes)
                     ) $ catMaybes txs'

  unless (null depTXs) $ do
    logF . concat $
      [ "Block hash "
      , format bHash
      , " has dependent transactions.\n"
      , show (map format depTXs)
      , " Inserting them into GetTransactions list"
      ]
    mapM_ requestTransaction depTXs
  if null txs''
    then return Nothing
    else return . Just $ buildBlock' (blockHeader b) txs'' (blockUncleHeaders b)

insertNewChainInfo :: HasPrivateHashDB h t b m => [(Word256,ChainInfo)] -> m ()
insertNewChainInfo chains = forM_ chains $ \(chainId,cInfo) -> do
  cHash <- generateInitialChainHash cInfo
  insertSeenChain chainId cInfo
  insertChainHash cHash chainId
  insertChainBufferEntry chainId cHash
  findChainHashUses chainId [cHash]
  runBlocks chainId

isPrivateHashTX :: TransactionLike t => t -> Bool
isPrivateHashTX = (== PrivateHash) . txType

isPrivateChainTX :: TransactionLike t => t -> Bool
isPrivateChainTX = isJust . txChainId
