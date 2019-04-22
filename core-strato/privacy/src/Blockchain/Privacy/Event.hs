{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}

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
import           Blockchain.Output
import           Blockchain.Privacy.Monad
import           Blockchain.Privacy.Metrics
import           Blockchain.Sequencer.Event
import           Blockchain.SHA
import           Blockchain.Strato.Model.Class
import           Control.Arrow                 ((&&&))
import           Control.Lens
import           Control.Monad
import           Control.Monad.Change.Alter
import           Control.Monad.IO.Class
import           Data.Foldable                 (for_, toList)
import           Data.Maybe
import           Data.Proxy
import qualified Data.Set                      as S
import qualified Data.Sequence                 as Q
import           Data.String
import           Data.Text                     (Text)
import qualified Data.Text                     as T
import           Data.Traversable
import           Prelude                       hiding (lookup)
import           Prometheus
import           Text.Format

logFF :: MonadLogger m => Text -> String -> m ()
logFF str = $logInfoS str . T.pack

lookupSeenChain :: (Word256 `Alters` ChainIdEntry) m => Word256 -> m Bool
lookupSeenChain chainId = isJust <$> lookup (Proxy :: Proxy ChainIdEntry) chainId

insertSeenChain :: (MonadIO m, (Word256 `Alters` ChainIdEntry) m)
                => Word256 -> ChainInfo -> m ()
insertSeenChain chainId cInfo = do
  liftIO $ withLabel chainMetrics "seen_chains" incCounter
  repsert_ Proxy chainId $ return . maybe (chainIdEntry cInfo) (chainIdInfo .~ cInfo)

insertTransaction :: (SHA `Alters` OutputTx) m => OutputTx -> m ()
insertTransaction = uncurry (insert Proxy) . (txHash &&& id)

findChainHashUses :: ( HasPrivateHashDB m
                     , (SHA `Alters` OutputBlock) m
                     , (SHA `Alters` ChainHashEntry) m
                     , (Word256 `Alters` ChainIdEntry) m
                     )
                  => Word256 -> [SHA] -> m ()
findChainHashUses chainId cHashes = do
  blocks <- toList
          . S.fromList
          . concat
          . map (toList . maybe Q.empty _inBlocks)
        <$> mapM (lookup (Proxy :: Proxy ChainHashEntry)) cHashes
  bOrders <- map (fmap blockOrdering) <$> mapM (lookup (Proxy :: Proxy OutputBlock)) blocks
  let infos = S.fromList . catMaybes $ zipWith (\b -> fmap (BlockInfo b)) blocks bOrders
  adjustStatefully_ (Proxy :: Proxy ChainIdEntry) chainId $ blocksToRun %= S.union infos

insertPrivateHash :: ( HasPrivateHashDB m
                     , (SHA `Alters` OutputBlock) m
                     , (SHA `Alters` ChainHashEntry) m
                     , (Word256 `Alters` ChainIdEntry) m
                     )
                  => OutputTx -> m ()
insertPrivateHash tx = case txChainId tx of
  Nothing -> error "insertPrivateHash: Trying to insert a public transaction"
  Just chainId -> do
    liftIO $ withLabel txMetrics "private_hash" incCounter
    cHashes <- generateChainHashes tx
    mapM_ (flip insertChainHash chainId) cHashes
    mapM_ (insertChainBufferEntry chainId) cHashes
    findChainHashUses chainId cHashes

insertChainHash :: (SHA `Alters` ChainHashEntry) m => SHA -> Word256 -> m ()
insertChainHash cHash chainId = repsert_ Proxy cHash $ \case
  Nothing -> pure $ chainHashEntryWithChainId chainId
  Just che -> pure $ (onChainId .~ Just chainId) che

useChainHash :: (Monad m, (SHA `Alters` ChainHashEntry) m) => SHA -> m ()
useChainHash cHash = adjustStatefully_ Proxy cHash $ used .= True

getChainBuffer :: (Word256 `Alters` ChainIdEntry) m => Word256 -> m (CircularBuffer SHA)
getChainBuffer chainId = maybe emptyCircularBuffer _chainHashes <$> lookup Proxy chainId

lookupChainBuffer :: (Word256 `Alters` ChainIdEntry) m => Word256 -> m (CircularBuffer SHA)
lookupChainBuffer = getChainBuffer

insertChainBufferEntry :: (MonadIO m, (Word256 `Alters` ChainIdEntry) m) => Word256 -> SHA -> m ()
insertChainBufferEntry chainId cHash = adjustStatefully_ Proxy chainId $ do
  CircularBuffer cap sz q <- use chainHashes
  liftIO $ withLabel chainBuffer (fromString (show chainId)) (flip setGauge (fromIntegral sz))
  if sz < cap
    then chainHashes .= CircularBuffer cap (sz + 1) (q Q.|> cHash)
    else case Q.viewl q of
           Q.EmptyL -> chainHashes .= CircularBuffer cap 1 (q Q.|> cHash)
           (_ Q.:< q') -> chainHashes .= CircularBuffer cap sz (q' Q.|> cHash)

getNewChainHash :: ( Monad m
                   , (SHA `Alters` ChainHashEntry) m
                   , (Word256 `Alters` ChainIdEntry) m
                   )
                => Word256 -> m SHA
getNewChainHash chainId = do
  CircularBuffer cap sz q <- getChainBuffer chainId
  case Q.viewl q of
    Q.EmptyL -> error $ "getNewChainHash: Empty chain buffer for chainId " ++ show chainId
    (h Q.:< q') -> do
      adjustStatefully_ (Proxy :: Proxy ChainIdEntry) chainId $
        chainHashes .= CircularBuffer cap (sz - 1) q'
      Just used' <- fmap _used <$> lookup (Proxy :: Proxy ChainHashEntry) h
      if not used'
        then useChainHash h >> return h
        else getNewChainHash chainId

insertChainInfo :: ( HasPrivateHashDB m
                   , (SHA `Alters` ChainHashEntry) m
                   , (Word256 `Alters` ChainIdEntry) m
                   )
                => Word256 -> ChainInfo -> m ()
insertChainInfo chainId cInfo = do
  h <- generateInitialChainHash cInfo
  insertSeenChain chainId cInfo
  insertChainHash h chainId
  insertChainBufferEntry chainId h

checkIfIsMissingTX :: ( HasPrivateHashDB m
                      , (SHA `Alters` ChainHashEntry) m
                      )
                   => SHA -> SHA -> m ()
checkIfIsMissingTX th ch = do
  let logF = logFF "runPrivateHashTX"
  mChainId <- join . fmap _onChainId <$> lookup Proxy ch
  case mChainId of
    Nothing -> do
      logF "We don't know this transaction's chain Id. Oh well..."
    Just chainId -> do
      logF . concat $
        [ "We know this transaction's chain Id. It's "
        , format (SHA chainId)
        , ". Requesting transaction from peers"
        ]
      useChainHash ch
      requestTransaction th

runPrivateHashTX :: ( HasPrivateHashDB m
                    , (SHA `Alters` OutputTx) m
                    , (SHA `Alters` ChainHashEntry) m
                    )
                 => SHA -> SHA -> m ()
runPrivateHashTX tHash cHash = do
  let logF = logFF "runPrivateHashTX"
  logF . concat $
    [ "Transforming transaction "
    , format tHash
    , " with chain hash "
    , format cHash
    ]
  mthe <- lookup (Proxy :: Proxy OutputTx) tHash
  for_ mthe . const $ repsert_ (Proxy :: Proxy ChainHashEntry) cHash $
    return . maybe chainHashEntryUsed (used .~ True)
  checkIfIsMissingTX tHash cHash

runBlocks :: ( HasPrivateHashDB m
             , (SHA `Alters` OutputBlock) m
             , (SHA `Alters` OutputTx) m
             , (SHA `Alters` ChainHashEntry) m
             , (Word256 `Alters` ChainIdEntry) m
             )
          => Word256 -> m [OutputBlock]
runBlocks chainId = go
  where
    go = do
      btr <- maybe S.empty _blocksToRun <$> lookup (Proxy :: Proxy ChainIdEntry) chainId
      if S.null btr
        then return []
        else do
          let b0 = S.elemAt 0 btr
          mBlock <- lookup (Proxy :: Proxy OutputBlock) (_bhash b0)
          fmap (fromMaybe [] . join) . for mBlock $ \block -> do
            mHydrated <- hydratePrivateHashes (Just chainId) block
            for mHydrated $ \b -> do
              adjustStatefully_ (Proxy :: Proxy ChainIdEntry) chainId $
                blocksToRun %= S.delete b0
              (b:) <$> go

accumT :: Monad m => s -> [a] -> (s -> a -> m (b,s)) -> m ([b],s)
accumT s [] _ = pure ([],s)
accumT s (a:as) run = do
  (b,s') <- run s a
  (bs,s'') <- accumT s' as run
  return (b:bs,s'')

hydratePrivateHashes :: ( HasPrivateHashDB m
                        , (SHA `Alters` OutputBlock) m
                        , (SHA `Alters` OutputTx) m
                        , (SHA `Alters` ChainHashEntry) m
                        , (Word256 `Alters` ChainIdEntry) m
                        )
                     => Maybe Word256
                     -> OutputBlock
                     -> m (Maybe OutputBlock)
hydratePrivateHashes chainF b = do
  let logF = logFF "hydratePrivateHashes"
      bHash = blockHeaderHash $ blockHeader b
  when (any isPrivateHashTX $ blockTransactions b) $
    insert (Proxy :: Proxy OutputBlock) bHash b
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
        repsert_ (Proxy :: Proxy ChainHashEntry) cHash $
          return . maybe
            (chainHashEntryInBlock bHash)
            (inBlocks %~ (Q.|> bHash))
        mChainId <- join . fmap _onChainId <$> lookup (Proxy :: Proxy ChainHashEntry) cHash
        case mChainId of
          Nothing -> do
            notHydrating "we don't know the chain ID"
            return (Nothing, st)
          Just chainId -> if discluded chainId || S.member chainId cs
            then do
              notHydrating "its chain ID is discluded from this hydration round"
              return (Nothing, st)
            else lookup (Proxy :: Proxy ChainIdEntry) chainId >>= \case
              Nothing -> do
                notHydrating "we don't have the info for its chain"
                return (Nothing, st)
              Just ChainIdEntry{..} -> do
                if not (S.null _blocksToRun || (_bhash $ S.elemAt 0 _blocksToRun) == bHash)
                  then do
                    notHydrating "this is not the chain's next block to run"
                    adjustStatefully_ (Proxy :: Proxy ChainIdEntry) chainId $
                      when (isNothing chainF) $
                        blocksToRun %= S.insert (BlockInfo bHash (blockOrdering b))
                    return (Nothing, (dts,S.insert chainId cs))
                  else do
                    lookup (Proxy :: Proxy OutputTx) tHash >>= \case
                      Nothing -> do
                        notHydrating "we don't have this transaction's body"
                        adjustStatefully_ (Proxy :: Proxy ChainIdEntry) chainId $ do
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

insertNewChainInfo :: ( HasPrivateHashDB m
                      , (SHA `Alters` OutputBlock) m
                      , (SHA `Alters` OutputTx) m
                      , (SHA `Alters` ChainHashEntry) m
                      , (Word256 `Alters` ChainIdEntry) m
                      )
                   => Word256
                   -> ChainInfo
                   -> m [OutputBlock]
insertNewChainInfo chainId cInfo = do
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
