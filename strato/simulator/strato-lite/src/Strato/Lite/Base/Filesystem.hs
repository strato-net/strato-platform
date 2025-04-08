{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE Rank2Types #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Lite.Base.Filesystem where

import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.Context hiding (actionTimestamp, blockHeaders, remainingBlockHeaders)
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockSummary
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Data.Transaction
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.P2PUtil (sockAddrToIP)
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.ChainDB
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.Model.SyncState
import Blockchain.Model.SyncTask
import Blockchain.Model.WrappedBlock
import qualified Blockchain.Sequencer.DB.DependentBlockDB as DBDB
import Blockchain.Strato.Indexer.IContext (API (..), IndexerException (..), P2P (..))
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Blockchain.SyncDB
import Conduit
import Control.Lens hiding (Context, view)
import Control.Monad (void)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Reader
import qualified Control.Monad.State as State
import Core.API
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.Conduit.Network
import Data.Default
import qualified Data.Map.Strict as M
import Data.List (foldl', sortOn)
import Data.Maybe (catMaybes, fromMaybe)
import qualified Data.NibbleString as N
import Data.Ord (Down(..))
import qualified Data.Text as T
import Data.Text.Encoding (encodeUtf8)
import Data.Time.Clock (addUTCTime, getCurrentTime)
import qualified Database.LevelDB as LDB
import Network.Socket
import qualified Network.Socket.ByteString as NB
import Network.Wai.Handler.Warp.Internal
import Strato.Lite.Base
import UnliftIO
import Prelude hiding (round)

data FilesystemDBs = FilesystemDBs
  { _stateDB :: MP.StateDB
  , _hashDB :: HashDB
  , _codeDB :: CodeDB
  , _blockSummaryDB :: BlockSummaryDB
  , _dependentBlockDB :: DBDB.DependentBlockDB
  , _x509DB :: LDB.DB
  , _canonicalDB :: LDB.DB
  , _blockDB :: LDB.DB
  , _kvDB :: LDB.DB
  }

makeLenses ''FilesystemDBs

data FilesystemPeer = FilesystemPeer
  { _filesystemPeerPrivKey     :: PrivateKey
  , _filesystemPeerTCPPort     :: TCPPort
  , _filesystemPeerUDPPort     :: UDPPort
  , _filesystemPeerUDPSocket   :: Socket
  , _filesystemPeerSyncTasks   :: TVar [SyncTask]
  , _filesystemDBs             :: FilesystemDBs
  }

makeLenses ''FilesystemPeer

type FilesystemM = ReaderT FilesystemPeer BaseM

type FilesystemT m = ReaderT FilesystemPeer m

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible PublicKey (FilesystemT m) where
  access _ = derivePublicKey <$> asks _filesystemPeerPrivKey

instance {-# OVERLAPPING #-} MonadIO m => HasVault (FilesystemT m) where
  sign bs = do
    pk <- asks _filesystemPeerPrivKey
    return $ signMsg pk bs
  getPub = do
    pk <- asks _filesystemPeerPrivKey
    return $ derivePublicKey pk
  getShared pub = do
    pk <- asks _filesystemPeerPrivKey
    return $ deriveSharedKey pk pub

instance {-# OVERLAPPING #-} MonadUnliftIO m => RunsClient (FilesystemT m) where
  runClientConnection (Host ip) (TCPPort p) sSource handler = do
    let peerAddress = BC.pack $ T.unpack ip
    runGeneralTCPClient (clientSettings p peerAddress) $ \app -> do
      let pSource = appSource app
          pSink = appSink app
          conduits = P2pConduits pSource pSink sSource
      handler conduits

instance {-# OVERLAPPING #-} MonadIO m => RunsServer (FilesystemT m) (LoggingT IO) where
  runServer (TCPPort listenPort) runner handler = do
    let settings = setAfterBind setSocketCloseOnExec $ serverSettings listenPort "*"
    runGeneralTCPServer settings $ \app -> runner $ \sSource -> do
      let pSource = appSource app
          pSink = appSink app
          conduits = P2pConduits pSource pSink sSource
          ip = Host . T.pack . sockAddrToIP $ appSockAddr app
      handler conduits ip

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable SockAddr B.ByteString (FilesystemT m) where
  replace _ addr packet = do
    sock' <- asks _filesystemPeerUDPSocket
    liftIO $ catch 
      (void $ NB.sendTo sock' packet addr) 
      (\(err :: IOError) -> runLoggingT . $logErrorS "NB.sendTo" . T.pack $ "Could not send data to " <> show addr <> "; got error: " <> show err)

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable () (B.ByteString, SockAddr) (FilesystemT m) where
  select _ _ = do
    s <- asks _filesystemPeerUDPSocket
    liftIO . timeout 10000000 $ NB.recvFrom s 80000

createFilesystemPeer ::
  PrivateKey ->
  TCPPort ->
  UDPPort ->
  Socket ->
  FilesystemDBs ->
  STM FilesystemPeer
createFilesystemPeer p t u s d = flip (FilesystemPeer p t u s) d <$> newTVar []

createFilesystemPeerIO ::
  PrivateKey ->
  TCPPort ->
  UDPPort ->
  Socket ->
  FilesystemDBs ->
  IO FilesystemPeer
createFilesystemPeerIO p t u s d = atomically $ createFilesystemPeer p t u s d

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible TCPPort (FilesystemT m) where
  access _ = asks _filesystemPeerTCPPort

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible UDPPort (FilesystemT m) where
  access _ = asks _filesystemPeerUDPPort

instance {-# OVERLAPPING #-} MonadIO m => (FilesystemT m) `Mod.Yields` DataDefs.TransactionResult where
  yield _ = pure () -- TODO

lookupLDB :: (MonadIO m, Binary k, Binary v) => (r -> LDB.DB) -> k -> ReaderT r m (Maybe v)
lookupLDB getDB k = do
  db <- asks getDB
  fmap (decode . BL.fromStrict) <$> LDB.get db LDB.defaultReadOptions (BL.toStrict $ encode k)

insertLDB :: (MonadIO m, Binary k, Binary v) => (r -> LDB.DB) -> k -> v -> ReaderT r m ()
insertLDB getDB k v = do
  db <- asks getDB
  LDB.put db LDB.defaultWriteOptions (BL.toStrict $ encode k) (BL.toStrict $ encode v)

deleteLDB :: (MonadIO m, Binary k) => (r -> LDB.DB) -> k -> ReaderT r m ()
deleteLDB getDB k = do
  db <- asks getDB
  LDB.delete db LDB.defaultWriteOptions (BL.toStrict $ encode k)

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` OutputBlock) (FilesystemT m) where
  lookup _ = lookupLDB $ _blockDB . _filesystemDBs
  insert _ = insertLDB $ _blockDB . _filesystemDBs
  delete _ = deleteLDB $ _blockDB . _filesystemDBs

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` API OutputTx) (FilesystemT m) where
  lookup _ _ = pure Nothing
  delete _ _ = pure ()
  insert _ _ _ = pure ()

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` API OutputBlock) (FilesystemT m) where
  lookup _ _ = pure Nothing
  delete _ _ = pure ()
  insert _ _ _ = pure ()

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` P2P OutputBlock) (FilesystemT m) where
  lookup _ k         = fmap P2P <$> lookupLDB (_blockDB . _filesystemDBs) k
  insert _ k (P2P v) = do
    insertLDB (_blockDB . _filesystemDBs) k v
    insertLDB (_canonicalDB . _filesystemDBs) (number $ obBlockData v) k
    txCount <- fromMaybe 0 <$> lookupLDB (_kvDB . _filesystemDBs) (encodeUtf8 "transaction_count")
    insertLDB (_kvDB . _filesystemDBs) (encodeUtf8 "transaction_count") (txCount + length (obReceiptTransactions v))
  delete _ k         = deleteLDB (_blockDB . _filesystemDBs) k

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable (P2P BestBlock) (FilesystemT m) where
  get _ = liftIO . throwIO $ Lookup "P2P" "()" "BestBlock"
  put _ = insertLDB (_kvDB . _filesystemDBs) (encodeUtf8 "best_block") . unP2P

instance {-# OVERLAPPING #-} MonadIO m => (Address `A.Alters` X509CertInfoState) (FilesystemT m) where
  lookup _ = lookupLDB $ _x509DB . _filesystemDBs
  insert _ = insertLDB $ _x509DB . _filesystemDBs
  delete _ = deleteLDB $ _x509DB . _filesystemDBs

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` DBDB.DependentBlockEntry) (FilesystemT m) where
  lookup _ = lookupLDB $ DBDB.getDependentBlockDB . _dependentBlockDB . _filesystemDBs
  insert _ = insertLDB $ DBDB.getDependentBlockDB . _dependentBlockDB . _filesystemDBs
  delete _ = deleteLDB $ DBDB.getDependentBlockDB . _dependentBlockDB . _filesystemDBs

updateSyncStatus' :: MonadIO m => FilesystemT m ()
updateSyncStatus' = do
  nodeNumber <- bestBlockNumber <$> Mod.get (Mod.Proxy @BestBlock)
  worldNumber <- bestBlockNumber . unWorldBestBlock <$> Mod.get (Mod.Proxy @WorldBestBlock)
  Mod.put (Mod.Proxy @SyncStatus) $ SyncStatus (nodeNumber >= worldNumber)

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable WorldBestBlock (FilesystemT m) where
  get _ = fromMaybe def <$> lookupLDB (_kvDB . _filesystemDBs) (encodeUtf8 "world_best_block")
  put _ v = do
    insertLDB (_kvDB . _filesystemDBs) (encodeUtf8 "world_best_block") v
    updateSyncStatus'

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe WorldBestBlock) (FilesystemT m) where
  access _ = lookupLDB (_kvDB . _filesystemDBs) (encodeUtf8 "world_best_block")

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable BestBlock (FilesystemT m) where
  get _ = fromMaybe def <$> lookupLDB (_kvDB . _filesystemDBs) (encodeUtf8 "best_block")
  put _ v = do
    insertLDB (_kvDB . _filesystemDBs) (encodeUtf8 "best_block") v
    updateSyncStatus'

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe BestBlock) (FilesystemT m) where
  access _ = lookupLDB (_kvDB . _filesystemDBs) (encodeUtf8 "best_block")

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable BestSequencedBlock (FilesystemT m) where
  get _ = fromMaybe def <$> lookupLDB (_kvDB . _filesystemDBs) (encodeUtf8 "best_sequenced_block")
  put _ v = do
    insertLDB (_kvDB . _filesystemDBs) (encodeUtf8 "best_sequenced_block") v
    updateSyncStatus'

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe BestSequencedBlock) (FilesystemT m) where
  access _ = lookupLDB (_kvDB . _filesystemDBs) (encodeUtf8 "best_sequenced_block")

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible [Validator] (FilesystemT m) where
  access _ = maybe [] bestSequencedBlockValidators <$> lookupLDB (_kvDB . _filesystemDBs) (encodeUtf8 "best_sequenced_block")

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable SyncStatus (FilesystemT m) where
  get _ = SyncStatus . fromMaybe False <$> lookupLDB (_kvDB . _filesystemDBs) (encodeUtf8 "sync_status")
  put _ = insertLDB (_kvDB . _filesystemDBs) (encodeUtf8 "sync_status") . unSyncStatus

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe SyncStatus) (FilesystemT m) where
  access _ = fmap SyncStatus <$> lookupLDB (_kvDB . _filesystemDBs) (encodeUtf8 "sync_status")

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable Integer (Canonical BlockHeader) (FilesystemT m) where
  select _ i = lookupLDB (_canonicalDB . _filesystemDBs) i >>= \case
    Nothing -> pure Nothing
    Just (bh :: Keccak256) -> fmap (Canonical . obBlockData) <$> lookupLDB (_blockDB . _filesystemDBs) bh

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable Integer (Canonical BlockHeader) (FilesystemT m) where
  replace _ i (Canonical b) = insertLDB (_canonicalDB . _filesystemDBs) i (headerHash b)

instance {-# OVERLAPPING #-} MonadIO m => GetLastBlocks (FilesystemT m) where
  getLastBlocks n = do
    BestBlock _ i <- Mod.get (Mod.Proxy @BestBlock)
    hashes :: [Keccak256] <- catMaybes <$> traverse (lookupLDB $ _canonicalDB . _filesystemDBs) [(max 0 (i-n))..i]
    obs <- A.lookupMany (A.Proxy @OutputBlock) hashes
    pure . map (outputBlockToBlock . snd) . sortOn (Down . fst) $ M.toList obs

instance {-# OVERLAPPING #-} MonadIO m => GetLastTransactions (FilesystemT m) where
  getLastTransactions _ n = do
    BestBlock _ i <- Mod.get (Mod.Proxy @BestBlock)
    now <- liftIO getCurrentTime
    let go :: Integer -> [(Integer, OutputTx)] -> Integer -> FilesystemT m [(Integer, OutputTx)]
        go l ts j
          | j <= 0 = pure ts
          | otherwise = lookupLDB (_canonicalDB . _filesystemDBs) j >>= \case
              Nothing -> go l ts (j - 1)
              Just (bh :: Keccak256) -> A.lookup (A.Proxy @OutputBlock) bh >>= \case
                Nothing -> go l ts (j - 1)
                Just ob -> let !l' = l + fromIntegral (length (obReceiptTransactions ob))
                               ts' = ts ++ ((number $ obBlockData ob,) <$> reverse (obReceiptTransactions ob))
                            in if l' >= n then pure $ take (fromIntegral n) ts' else go l' ts' (j - 1)
        toRawTx blkNum OutputTx{..} = txAndTime2RawTX otOrigin otBaseTx blkNum now
    map (uncurry toRawTx) <$> go 0 [] i

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable AccountsFilterParams [DataDefs.AddressStateRef] (FilesystemT m) where
  -- TODO: Add AddressStateRef map to filesystemContext
  select _ _ = pure Nothing -- AccountsFilterParams{..} = case _qaAddress of
    -- Nothing -> pure $ Just []
    -- Just addr -> do
    --   bh <- bestBlockHash <$> use filesystemContextBestBlock
    --   withCurrentBlockHash bh $ A.lookup (A.Proxy @AddressState) addr >>= \case
    --     Nothing -> pure $ Just []
    --     Just AddressState{..} -> do
    --       let (mCH, mCN, mCPA) = case addressStateCodeHash of
    --             ExternallyOwned h -> (Just h, Nothing, Nothing) 
    --             SolidVMCode n h   -> (Just h, Just n, Nothing)
    --             CodeAtAccount a n -> (Nothing, Just n, Just a)
    --       pure . Just . (:[]) $ DataDefs.AddressStateRef
    --         { DataDefs.addressStateRefAddress = addr
    --         , DataDefs.addressStateRefNonce = addressStateNonce
    --         , DataDefs.addressStateRefBalance = addressStateBalance
    --         , DataDefs.addressStateRefContractRoot = addressStateContractRoot
    --         , DataDefs.addressStateRefCodeHash = mCH
    --         , DataDefs.addressStateRefContractName = mCN
    --         , DataDefs.addressStateRefCodePtrAddress = mCPA
    --         , DataDefs.addressStateRefLatestBlockDataRefNumber = -1
    --         }

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable BlocksFilterParams [Block] (FilesystemT m) where
  select _ _ = Just <$> getLastBlocks 1000 -- TODO

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable StorageFilterParams [StorageAddress] (FilesystemT m) where
  select _ _ = pure $ Just [] -- TODO

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable TxsFilterParams [DataDefs.RawTransaction] (FilesystemT m) where
  select _ tfp = case qtHash tfp of
    Nothing -> Just <$> getLastTransactions Nothing 1000
    Just _ -> pure Nothing -- TODO

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable Keccak256 [DataDefs.TransactionResult] (FilesystemT m) where
  select _ _ = pure Nothing -- TODO

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible TransactionCount (FilesystemT m) where
  access _ = TransactionCount . fromMaybe 0 <$> lookupLDB (_kvDB . _filesystemDBs) (encodeUtf8 "transaction_count")

instance {-# OVERLAPPING #-} MonadIO m => State.MonadState [SyncTask] (FilesystemT m) where
  state f =
    asks _filesystemPeerSyncTasks >>= \tasks -> liftIO . atomically $ do
      s <- readTVar tasks
      let (a, s') = f s
      writeTVar tasks s'
      pure a

instance {-# OVERLAPPING #-} MonadIO m => HasSyncDB (FilesystemT m) where
  clearAllSyncTasks host = State.modify' $ map (\st@(SyncTask i t h s) -> if h == host then SyncTask i t (Host "") s else st)
  getCurrentSyncTask host = do
    let assignedByHost (SyncTask _ _ h s) = h == host && s == Assigned
    tasks <- filter assignedByHost <$> State.get
    case tasks of
      [t] -> pure $ Just t
      [] -> pure Nothing
      _ -> error $ "multiple sync tasks found in call to getCurrentSyncTask:\n" ++ unlines (show <$> tasks)
  getNewSyncTask "127.0.0.1" _ = pure Nothing
  getNewSyncTask host _ = do -- TODO: Figure out what highestBlockNum (second parameter) is used for
    now <- liftIO getCurrentTime
    let oneMinuteAgo = addUTCTime (-60) now
    unsortedTasks <- State.get
    let sortedTasks = sortOn (\(SyncTask _ t _ _) -> t) unsortedTasks
        foldTasks (Nothing, tasks) st@(SyncTask i t _ s) =
          if t < oneMinuteAgo && s /= Finished
            then let newTask = SyncTask i now host s
                  in (Just newTask, newTask:tasks)
            else (Nothing, st:tasks)
        foldTasks (newTask, tasks) st = (newTask, st:tasks)
        (mNewTask, updatedTasks) = foldl' foldTasks (Nothing, []) sortedTasks
    case mNewTask of
      Nothing -> do
        let newTask = SyncTask (maximum (0:((\(SyncTask i _ _ _) -> i) <$> updatedTasks))) now host Assigned
        State.put $ newTask : updatedTasks
        pure $ Just newTask
      Just newTask -> do
        State.put updatedTasks
        pure $ Just newTask
  setSyncTaskFinished host = State.modify' $ map (\st@(SyncTask i t h _) -> if h == host then SyncTask i t h Finished else st)
  setSyncTaskNotReady host = State.modify' $ map (\st@(SyncTask i t h s) -> if h == host && s == Assigned then SyncTask i t h NotReady else st)

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable BlockHashRoot (FilesystemT m) where
  get _ = BlockHashRoot . fromMaybe def <$> lookupLDB (_kvDB . _filesystemDBs) (encodeUtf8 "block_hash_root")
  put _ = insertLDB (_kvDB . _filesystemDBs) (encodeUtf8 "block_hash_root") . unBlockHashRoot

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable GenesisRoot (FilesystemT m) where
  get _ = GenesisRoot . fromMaybe def <$> lookupLDB (_kvDB . _filesystemDBs) (encodeUtf8 "genesis_root")
  put _ = insertLDB (_kvDB . _filesystemDBs) (encodeUtf8 "genesis_root") . unGenesisRoot

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable BestBlockRoot (FilesystemT m) where
  get _ = BestBlockRoot . fromMaybe def <$> lookupLDB (_kvDB . _filesystemDBs) (encodeUtf8 "best_block_root")
  put _ = insertLDB (_kvDB . _filesystemDBs) (encodeUtf8 "best_block_root") . unBestBlockRoot

instance {-# OVERLAPPING #-} MonadIO m => (MP.StateRoot `A.Alters` MP.NodeData) (FilesystemT m) where
  lookup _ = lookupLDB $ MP.unStateDB . _stateDB . _filesystemDBs
  insert _ = insertLDB $ MP.unStateDB . _stateDB . _filesystemDBs
  delete _ = deleteLDB $ MP.unStateDB . _stateDB . _filesystemDBs

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` DBCode) (FilesystemT m) where
  lookup _ = lookupLDB $ unCodeDB . _codeDB . _filesystemDBs
  insert _ = insertLDB $ unCodeDB . _codeDB . _filesystemDBs
  delete _ = deleteLDB $ unCodeDB . _codeDB . _filesystemDBs

instance {-# OVERLAPPING #-} MonadIO m => (N.NibbleString `A.Alters` N.NibbleString) (FilesystemT m) where
  lookup _ = genericLookupHashDB . asks $ _hashDB . _filesystemDBs
  insert _ = genericInsertHashDB . asks $ _hashDB . _filesystemDBs
  delete _ = genericDeleteHashDB . asks $ _hashDB . _filesystemDBs

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` BlockSummary) (FilesystemT m) where
  lookup _ = genericLookupBlockSummaryDB . asks $ _blockSummaryDB . _filesystemDBs
  insert _ = genericInsertBlockSummaryDB . asks $ _blockSummaryDB . _filesystemDBs
  delete _ = genericDeleteBlockSummaryDB . asks $ _blockSummaryDB . _filesystemDBs