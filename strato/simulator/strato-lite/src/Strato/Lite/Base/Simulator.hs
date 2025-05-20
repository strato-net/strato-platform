{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
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

module Strato.Lite.Base.Simulator where

import BlockApps.Logging
import BlockApps.X509.Certificate as X509
import Blockchain.Context hiding (actionTimestamp, blockHeaders, remainingBlockHeaders)
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockSummary
import Blockchain.Data.CirrusDefs
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Data.PubKey
import Blockchain.Data.Transaction
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.DB.ChainDB
import Blockchain.DB.CodeDB
import Blockchain.MemVMContext (MemContextDBs(..), blockSummaryDB, stateDB, hashDB, codeDB, blockHashRoot, genesisRoot, bestBlockRoot)
import Blockchain.Model.SyncState
import Blockchain.Model.SyncTask
import Blockchain.Model.WrappedBlock
import qualified Blockchain.Sequencer.DB.DependentBlockDB as DBDB
import Blockchain.Strato.Discovery.ContextLite (UDPPacket(..))
import Blockchain.Strato.Discovery.Data.MemPeerDB
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Discovery.UDP
import Blockchain.Strato.Indexer.IContext (API (..), IndexerException(..), P2P (..))
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Blockchain.Strato.StateDiff
import Blockchain.SyncDB
import Conduit
import Control.Lens hiding (Context, view)
import qualified Control.Lens as Lens
import Control.Monad (forever, void)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Reader
import qualified Control.Monad.State as State
import Core.API
import Crypto.Types.PubKey.ECC
import Data.Bits
import qualified Data.Aeson as Aeson
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Conduit.TQueue hiding (newTQueueIO)
import Data.Default
import Data.Foldable (traverse_)
import Data.List (foldl', sortOn)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Data.Maybe (catMaybes, listToMaybe)
import qualified Data.NibbleString as N
import Data.Ord (Down(..))
import qualified Data.Text as T
import qualified Data.Text.Encoding as Text
import Data.Time.Clock (addUTCTime)
import Data.Time.Clock.POSIX
import Debugger (SourceMap(..))
import Network.Socket
import Strato.Lite.Base
import Text.Read (readMaybe)
import UnliftIO
import Prelude hiding (round)

data VSocket = VSocket
  { _inbound :: TQueue B.ByteString,
    _outbound :: TQueue B.ByteString
  }

makeLenses ''VSocket

newVSocket :: IO VSocket
newVSocket = liftA2 VSocket newTQueueIO newTQueueIO

data Internet = Internet
  { _tcpPorts :: Map (Host, TCPPort) (TQueue (VSocket, Host)),
    _udpPorts :: Map (Host, UDPPort) (TQueue (B.ByteString, SockAddr))
  }

makeLenses ''Internet

data SimulatorContext = SimulatorContext
  { _simulatorContextWorldBestBlock        :: WorldBestBlock
  , _simulatorContextBestBlock             :: BestBlock
  , _simulatorContextBestSequencedBlock    :: BestSequencedBlock
  , _simulatorContextCanonicalBlockHashMap :: Map Integer (Canonical Keccak256)
  , _simulatorContextBlockRegistry         :: Map Keccak256 OutputBlock
  , _simulatorContextDBERegistry           :: Map Keccak256 DBDB.DependentBlockEntry
  , _simulatorContextX509CertMap           :: Map Address X509CertInfoState
  , _simulatorContextPeerMap               :: MemPeerDBEnv
  , _simulatorContextTransactionResults    :: [DataDefs.TransactionResult]
  , _simulatorContextSyncStatus            :: SyncStatus
  , _simulatorContextSyncTasks             :: [SyncTask]
  , _simulatorContextMemContextDBs         :: MemContextDBs
  }

makeLenses ''SimulatorContext

data SimulatorPeer = SimulatorPeer
  { _simulatorPeerPrivKey   :: PrivateKey
  , _simulatorPeerIPAddress :: Host
  , _simulatorPeerInternet  :: TVar Internet
  , _simulatorMyUDPSocket   :: TQueue (B.ByteString, SockAddr)
  , _simulatorPeerContext   :: TVar SimulatorContext
  }

makeLenses ''SimulatorPeer

type SimulatorM = ReaderT SimulatorPeer (MemPeerDBM BaseM)

type MonadSimulator m = ReaderT SimulatorPeer (MemPeerDBM m)

instance {-# OVERLAPPING #-} MonadIO m => State.MonadState SimulatorContext (MonadSimulator m) where
  state f =
    asks _simulatorPeerContext >>= \ctx -> liftIO . atomically $ do
      s <- readTVar ctx
      let (a, s') = f s
      writeTVar ctx s'
      pure a

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible PublicKey (MonadSimulator m) where
  access _ = derivePublicKey <$> asks _simulatorPeerPrivKey

instance {-# OVERLAPPING #-} MonadIO m => HasVault (MonadSimulator m) where
  sign bs = do
    pk <- asks _simulatorPeerPrivKey
    return $ signMsg pk bs

  getPub = do
    pk <- asks _simulatorPeerPrivKey
    return $ derivePublicKey pk

  getShared pub = do
    pk <- asks _simulatorPeerPrivKey
    return $ deriveSharedKey pk pub

instance {-# OVERLAPPING #-} (MonadIO m, MonadLogger m) => RunsClient (MonadSimulator m) where
  runClientConnection ipAsText@(Host ip) tcpPort@(TCPPort p) sSource f = do
    inet <- asks _simulatorPeerInternet
    mSock <- M.lookup (ipAsText, tcpPort) . _tcpPorts <$> readTVarIO inet
    case mSock of
      Nothing -> $logErrorS "runClientConnection" $ "No socket exists for " <> T.pack (show ip) <> ":" <> T.pack (show p)
      Just s -> do
        myIP <- asks _simulatorPeerIPAddress
        i <- liftIO $ newTQueueIO
        o <- liftIO $ newTQueueIO
        let pSource = sourceTQueue o
            pSink = sinkTQueue i
            v = VSocket i o
        atomically $ writeTQueue s (v, myIP)
        f $ P2pConduits pSource pSink sSource

instance {-# OVERLAPPING #-} (MonadUnliftIO m, MonadLogger m) => RunsServer (MonadSimulator m) (LoggingT IO) where
  runServer tcpPort@(TCPPort p) runner f = runner $ \sSource -> do
    inet <- asks _simulatorPeerInternet
    myIP@(Host ip) <- asks _simulatorPeerIPAddress
    mSock <- liftIO $ M.lookup (myIP, tcpPort) . _tcpPorts <$> readTVarIO inet
    case mSock of
      Nothing -> $logErrorS "runServer" $ "No socket exists for " <> T.pack (show ip) <> ":" <> T.pack (show p)
      Just s -> forever $ do
        (VSocket i o, otherIP) <- atomically $ readTQueue s
        let pSource = sourceTQueue i
            pSink = sinkTQueue o
        void . async $ f (P2pConduits pSource pSink sSource) otherIP

instance {-# OVERLAPPING #-} (MonadIO m, MonadLogger m) => A.Replaceable SockAddr B.ByteString (MonadSimulator m) where
  replace _ addr msg = case sockAddrToIpAndPort addr of
    Nothing -> $logErrorS "Replaceable SockAddr BS" $ "Could not decode " <> T.pack (show addr)
    Just (ip@(Host ipText), udpPort@(UDPPort port')) -> do
      inet <- asks _simulatorPeerInternet
      mSock <- liftIO $ M.lookup (ip, udpPort) . _udpPorts <$> readTVarIO inet
      case mSock of
        Nothing -> $logErrorS "runServer" $ "No socket exists for " <> ipText <> ":" <> T.pack (show port')
        Just s -> do
          ip' <- asks _simulatorPeerIPAddress
          case ipAndPortToSockAddr ip' (UDPPort 30303) of
            Nothing -> pure ()
            Just myAddr -> atomically $ writeTQueue s (msg, myAddr)

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable (Maybe Host, UDPPort) SockAddr (MonadSimulator m) where
  select _ (Just ip, udpPort) = pure $ ipAndPortToSockAddr ip udpPort
  select _ (Nothing, udpPort) = do
    myIP <- asks _simulatorPeerIPAddress
    pure $ ipAndPortToSockAddr myIP udpPort

instance {-# OVERLAPPING #-} MonadUnliftIO m => Mod.Awaitable UDPPacket (MonadSimulator m) where
  await = do
    s <- asks _simulatorMyUDPSocket
    mMsg <- timeout 10000000 . atomically $ readTQueue s
    pure $ UDPPacket <$> mMsg

instance {-# OVERLAPPING #-} (MonadUnliftIO m, MonadLogger m) => A.Selectable (Host, UDPPort, B.ByteString) Point (MonadSimulator m) where
  select _ (ip@(Host ip'), port@(UDPPort p), bs) = do
    inet <- asks _simulatorPeerInternet
    mSock <- M.lookup (ip, port) . _udpPorts <$> readTVarIO inet
    myIP@(Host myip) <- asks _simulatorPeerIPAddress
    case mSock of
      Nothing -> do
        $logWarnS "getPubKey" $ "No socket exists for " <> ip' <> ":" <> T.pack (show p)
        pure Nothing
      Just s -> do
        myS <- asks _simulatorMyUDPSocket
        case ipAndPortToSockAddr myIP (UDPPort 30303) of
          Nothing -> do
            $logWarnS "strato-lite/getPubKey" $ "Could not get SockAddr for our IP address: " <> myip <> ":" <> T.pack (show p)
            pure Nothing
          Just addr -> do
            atomically $ writeTQueue s (bs, addr)
            mResp <- timeout 5000000 . atomically $ readTQueue myS
            pure $ secPubKeyToPoint . processDataStream' . fst <$> mResp

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` OutputBlock) (MonadSimulator m) where
  lookup _ k = do
    ctx <- asks _simulatorPeerContext
    M.lookup k . _simulatorContextBlockRegistry <$> atomically (readTVar ctx)
  insert _ k p = do
    ctx <- asks _simulatorPeerContext
    atomically . modifyTVar ctx $ (simulatorContextBlockRegistry . at k ?~ p)
  delete _ k = do
    ctx <- asks _simulatorPeerContext
    atomically . modifyTVar ctx $ simulatorContextBlockRegistry . at k .~ Nothing

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible TCPPort (MonadSimulator m) where
  access _ = pure $ TCPPort 30303

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible UDPPort (MonadSimulator m) where
  access _ = pure $ UDPPort 30303

instance {-# OVERLAPPING #-} MonadIO m => (MonadSimulator m) `Mod.Yields` DataDefs.TransactionResult where
  yield txr = simulatorContextTransactionResults %= (txr:)

instance {-# OVERLAPPING #-} Monad m => (MonadSimulator m) `Mod.Outputs` StateDiff where
  output _ = pure () 

instance {-# OVERLAPPING #-} (MonadIO m, MonadLogger m) => (MonadSimulator m) `Mod.Outputs` SlipstreamCommands where
  output (SlipstreamCommands cmds) = traverse_ ($logInfoS ("slipstream/cmds")) $ concatMap T.lines cmds

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` API OutputTx) (MonadSimulator m) where
  lookup _ _ = pure Nothing
  delete _ _ = pure ()
  insert _ _ _ = pure ()

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` API OutputBlock) (MonadSimulator m) where
  lookup _ k   = fmap API <$> A.lookup (A.Proxy @OutputBlock) k
  insert _ k v = A.insert (A.Proxy @OutputBlock) k $ unAPI v
  delete _ k   = A.delete (A.Proxy @OutputBlock) k

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` P2P OutputBlock) (MonadSimulator m) where
  lookup _ k   = fmap P2P <$> A.lookup (A.Proxy @OutputBlock) k
  insert _ k (P2P v) = do
    A.insert (A.Proxy @OutputBlock) k v
    simulatorContextCanonicalBlockHashMap . at (number $ obBlockData v) ?= Canonical k
  delete _ k   = A.delete (A.Proxy @OutputBlock) k

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable (P2P BestBlock) (MonadSimulator m) where
  get _ = liftIO . throwIO $ Lookup "P2P" "()" "BestBlock"
  put _ (P2P bb) = simulatorContextBestBlock .= bb

instance {-# OVERLAPPING #-} MonadIO m => (Address `A.Alters` X509CertInfoState) (MonadSimulator m) where
  lookup _ k = do
    ctx <- asks _simulatorPeerContext
    M.lookup k . _simulatorContextX509CertMap <$> atomically (readTVar ctx)
  lookupMany _ ks = do
    ctx <- asks _simulatorPeerContext
    atomically $ do
      m <- _simulatorContextX509CertMap <$> readTVar ctx
      pure . M.fromList . catMaybes $ (\k -> (k,) <$> M.lookup k m) <$> ks
  insert _ k v = do
    ctx <- asks _simulatorPeerContext
    atomically . modifyTVar ctx $ simulatorContextX509CertMap . at k ?~ v
  insertMany _ kvs = do
    ctx <- asks _simulatorPeerContext
    atomically . modifyTVar ctx $ simulatorContextX509CertMap %~ M.union kvs
  delete _ k = do
    ctx <- asks _simulatorPeerContext
    atomically . modifyTVar ctx $ simulatorContextX509CertMap . at k .~ Nothing
  deleteMany _ ks = do
    ctx <- asks _simulatorPeerContext
    atomically . modifyTVar ctx $ simulatorContextX509CertMap %~ flip M.difference (M.fromList . zip ks $ repeat ())

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable Validator X509CertInfoState (MonadSimulator m) where
  select _ (Validator k) = do
    ctx <- asks _simulatorPeerContext
    atomically $ listToMaybe . filter ((== k) . T.pack . commonName) . M.elems . _simulatorContextX509CertMap <$> readTVar ctx
  selectMany _ ks = do
    ctx <- asks _simulatorPeerContext
    atomically $ do
      m <- M.fromList . map (\(_,v) -> (Validator . T.pack $ commonName v, v)) . M.toList . _simulatorContextX509CertMap <$> readTVar ctx
      pure . M.fromList . catMaybes $ (\k -> (k,) <$> M.lookup k m) <$> ks

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` DBDB.DependentBlockEntry) (MonadSimulator m) where
  lookup _ k = do
    ctx <- asks _simulatorPeerContext
    M.lookup k . _simulatorContextDBERegistry <$> atomically (readTVar ctx)
  insert _ k v = do
    ctx <- asks _simulatorPeerContext
    atomically . modifyTVar ctx $ simulatorContextDBERegistry . at k ?~ v
  delete _ k = do
    ctx <- asks _simulatorPeerContext
    atomically . modifyTVar ctx $ simulatorContextDBERegistry . at k .~ Nothing

updateSyncStatus :: MonadIO m => MonadSimulator m ()
updateSyncStatus = do
  nodeNumber <- bestBlockNumber <$> Mod.get (Mod.Proxy @BestBlock)
  worldNumber <- bestBlockNumber . unWorldBestBlock <$> Mod.get (Mod.Proxy @WorldBestBlock)
  Mod.put (Mod.Proxy @SyncStatus) $ SyncStatus (nodeNumber >= worldNumber)

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable WorldBestBlock (MonadSimulator m) where
  get _ = use simulatorContextWorldBestBlock
  put _ wbb = do
    assign simulatorContextWorldBestBlock wbb
    updateSyncStatus

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe WorldBestBlock) (MonadSimulator m) where
  access _ = Just <$> use simulatorContextWorldBestBlock

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable BestBlock (MonadSimulator m) where
  get _ = use simulatorContextBestBlock
  put _ bb = do
    assign simulatorContextBestBlock bb
    updateSyncStatus

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe BestBlock) (MonadSimulator m) where
  access _ = Just <$> use simulatorContextBestBlock

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable BestSequencedBlock (MonadSimulator m) where
  get _ = use simulatorContextBestSequencedBlock
  put _ bsb = do
    assign simulatorContextBestSequencedBlock bsb
    updateSyncStatus

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe BestSequencedBlock) (MonadSimulator m) where
  access _ = Just <$> use simulatorContextBestSequencedBlock

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible [Validator] (MonadSimulator m) where
  access _ = do
    bestSequencedBlock <- Mod.get (Mod.Proxy @BestSequencedBlock)
    pure $ bestSequencedBlockValidators bestSequencedBlock

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable SyncStatus (MonadSimulator m) where
  get _ = use simulatorContextSyncStatus
  put _ = assign simulatorContextSyncStatus

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe SyncStatus) (MonadSimulator m) where
  access _ = Just <$> use simulatorContextSyncStatus

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable Integer (Canonical BlockHeader) (MonadSimulator m) where
  select _ i = M.lookup i <$> use simulatorContextCanonicalBlockHashMap >>= \case
    Nothing -> pure Nothing
    Just (Canonical bh) -> fmap (Canonical . obBlockData) <$> A.lookup (A.Proxy @OutputBlock) bh

instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable Integer (Canonical BlockHeader) (MonadSimulator m) where
  replace _ i (Canonical b) = simulatorContextCanonicalBlockHashMap . at i ?= (Canonical $ blockHeaderHash b)

instance {-# OVERLAPPING #-} MonadIO m => GetLastBlocks (MonadSimulator m) where
  getLastBlocks n = do
    lastBlockHashes <- map (unCanonical . snd) . take (fromInteger n) . sortOn (Down . fst) . M.toList <$> use simulatorContextCanonicalBlockHashMap
    ctx <- asks _simulatorPeerContext
    bhr <- _simulatorContextBlockRegistry <$> atomically (readTVar ctx)
    pure . catMaybes $ fmap outputBlockToBlock . flip M.lookup bhr <$> lastBlockHashes

instance {-# OVERLAPPING #-} MonadIO m => GetLastTransactions (MonadSimulator m) where
  getLastTransactions n = do
    lastBlockHashes <- map (unCanonical . snd) . sortOn (Down . fst) . M.toList <$> use simulatorContextCanonicalBlockHashMap
    ctx <- asks _simulatorPeerContext
    bhr <- _simulatorContextBlockRegistry <$> atomically (readTVar ctx)
    time <- liftIO getCurrentTime
    let toRawTx blkNum OutputTx{..} = txAndTime2RawTX otOrigin otBaseTx blkNum time
        getRawTxs OutputBlock{..} = toRawTx (blockHeaderBlockNumber obBlockData) <$> reverse obReceiptTransactions
    pure . take (fromInteger n) . concat . catMaybes $ fmap getRawTxs . flip M.lookup bhr <$> lastBlockHashes

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable TxsFilterParams [DataDefs.RawTransaction] (MonadSimulator m) where
  select _ tfp = case qtHash tfp of
    Nothing -> Just <$> getLastTransactions 1000
    Just h -> do
      time <- liftIO getCurrentTime
      let toRawTx OutputTx{..} = txAndTime2RawTX otOrigin otBaseTx (-1) time
      ctx <- asks _simulatorPeerContext
      bhr <- _simulatorContextBlockRegistry <$> atomically (readTVar ctx)
      let blockTxs = map toRawTx . concatMap obReceiptTransactions $ M.elems bhr
      pure . Just . filter (\r -> DataDefs.rawTransactionTxHash r == h) $ blockTxs

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable Keccak256 [DataDefs.TransactionResult] (MonadSimulator m) where
  select _ h = Just . filter ((==) h . DataDefs.transactionResultTransactionHash) <$> use simulatorContextTransactionResults

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible TransactionCount (MonadSimulator m) where
  access _ = do
    ctx <- asks _simulatorPeerContext
    bhr <- _simulatorContextBlockRegistry <$> atomically (readTVar ctx)
    pure . TransactionCount . fromIntegral . length . concat . map obReceiptTransactions $ M.elems bhr

instance {-# OVERLAPPING #-} MonadIO m => HasSyncDB (MonadSimulator m) where
  clearAllSyncTasks host = simulatorContextSyncTasks %= map (\st@(SyncTask i t h s) -> if h == host then SyncTask i t (Host "") s else st)
  getCurrentSyncTask host = do
    let assignedByHost (SyncTask _ _ h s) = h == host && s == Assigned
    tasks <- filter assignedByHost <$> use simulatorContextSyncTasks
    case tasks of
      [t] -> pure $ Just t
      [] -> pure Nothing
      _ -> error $ "multiple sync tasks found in call to getCurrentSyncTask:\n" ++ unlines (show <$> tasks)
  getNewSyncTask "127.0.0.1" _ = pure Nothing
  getNewSyncTask host _ = do -- TODO: Figure out what highestBlockNum (second parameter) is used for
    now <- liftIO getCurrentTime
    let oneMinuteAgo = addUTCTime (-60) now
    unsortedTasks <- use simulatorContextSyncTasks
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
        simulatorContextSyncTasks .= newTask : updatedTasks
        pure $ Just newTask
      Just newTask -> do
        simulatorContextSyncTasks .= updatedTasks
        pure $ Just newTask
  setSyncTaskFinished host = simulatorContextSyncTasks %= map (\st@(SyncTask i t h _) -> if h == host then SyncTask i t h Finished else st)
  setSyncTaskNotReady host = simulatorContextSyncTasks %= map (\st@(SyncTask i t h s) -> if h == host && s == Assigned then SyncTask i t h NotReady else st)

dbsGet :: MonadIO m => MonadSimulator m MemContextDBs
dbsGet = _simulatorContextMemContextDBs <$> (asks _simulatorPeerContext >>= atomically . readTVar)
{-# INLINE dbsGet #-}

dbsGets :: MonadIO m => (MemContextDBs -> a) -> MonadSimulator m a
dbsGets f = f <$> dbsGet
{-# INLINE dbsGets #-}

dbsPut :: MonadIO m => MemContextDBs -> MonadSimulator m ()
dbsPut c = asks _simulatorPeerContext >>= \i -> atomically . modifyTVar' i $ simulatorContextMemContextDBs .~ c
{-# INLINE dbsPut #-}

dbsModify :: MonadIO m => (MemContextDBs -> MemContextDBs) -> MonadSimulator m ()
dbsModify f = asks _simulatorPeerContext >>= \i -> atomically . modifyTVar' i $ simulatorContextMemContextDBs %~ f
{-# INLINE dbsModify #-}

dbsModify' :: MonadIO m => (MemContextDBs -> MemContextDBs) -> MonadSimulator m ()
dbsModify' f = asks _simulatorPeerContext >>= \i -> atomically . modifyTVar' i $ simulatorContextMemContextDBs %~ f
{-# INLINE dbsModify' #-}

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable BlockHashRoot (MonadSimulator m) where
  get _ = dbsGets $ Lens.view blockHashRoot
  put _ bhr = dbsModify' $ blockHashRoot .~ bhr

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable GenesisRoot (MonadSimulator m) where
  get _ = dbsGets $ Lens.view genesisRoot
  put _ gr = dbsModify' $ genesisRoot .~ gr

instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable BestBlockRoot (MonadSimulator m) where
  get _ = dbsGets $ Lens.view bestBlockRoot
  put _ bbr = dbsModify' $ bestBlockRoot .~ bbr

instance {-# OVERLAPPING #-} MonadIO m => (MP.StateRoot `A.Alters` MP.NodeData) (MonadSimulator m) where
  lookup _ sr = dbsGets $ Lens.view (stateDB . at sr)
  insert _ sr nd = dbsModify' $ stateDB . at sr ?~ nd
  delete _ sr = dbsModify' $ stateDB . at sr .~ Nothing

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` DBCode) (MonadSimulator m) where
  lookup _ k = dbsGets $ Lens.view (codeDB . at k)
  insert _ k c = dbsModify' $ codeDB . at k ?~ c
  delete _ k = dbsModify' $ codeDB . at k .~ Nothing

instance {-# OVERLAPPING #-} MonadIO m => (N.NibbleString `A.Alters` N.NibbleString) (MonadSimulator m) where
  lookup _ n1 = dbsGets $ Lens.view (hashDB . at n1)
  insert _ n1 n2 = dbsModify' $ hashDB . at n1 ?~ n2
  delete _ n1 = dbsModify' $ hashDB . at n1 .~ Nothing

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` BlockSummary) (MonadSimulator m) where
  lookup _ k = dbsGets $ Lens.view (blockSummaryDB . at k)
  insert _ k bs = dbsModify' $ blockSummaryDB . at k ?~ bs
  delete _ k = dbsModify' $ blockSummaryDB . at k .~ Nothing

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable Address Integer (MonadSimulator m) where
  select _ _ = pure $ Just 0

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable Keccak256 SourceMap (MonadSimulator m) where
  select _ ch = A.lookup (A.Proxy @DBCode) ch >>= \case 
    Nothing -> pure Nothing
    Just (_, codeBS) -> case Aeson.decode' $ BL.fromStrict codeBS of
      Just codeMap -> pure . Just . SourceMap $ M.toList codeMap
      Nothing -> case Text.decodeUtf8' codeBS of
        Left _ -> pure Nothing
        Right codeText -> pure . Just $ SourceMap [("", codeText)]

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible [DataDefs.RawTransaction] (MonadSimulator m) where
  access _ = pure []

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable AccountsFilterParams [DataDefs.AddressStateRef] (MonadSimulator m) where
  select _ _ = pure Nothing

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable BlocksFilterParams [Block] (MonadSimulator m) where
  select _ BlocksFilterParams{..} = case qbHash of
    Just bh -> Just . maybe [] (:[]) . fmap outputBlockToBlock <$> A.lookup (A.Proxy @OutputBlock) bh
    Nothing -> case qbNumber of
      Just n -> A.select (A.Proxy @(Canonical BlockHeader)) (fromIntegral n :: Integer) >>= \case
        Nothing -> pure $ Just []
        Just (Canonical bd) -> Just . maybe [] (:[]) . fmap outputBlockToBlock <$> A.lookup (A.Proxy @OutputBlock) (headerHash bd)
      Nothing -> Just <$> getLastBlocks 100 -- TODO

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable StorageFilterParams [StorageAddress] (MonadSimulator m) where
  select _ _ = pure Nothing

instance {-# OVERLAPPING #-} Monad m => A.Selectable Address Certificate (MonadSimulator m) where
  select _ _ = pure Nothing

preAlGoreInternet :: Internet
preAlGoreInternet = Internet M.empty M.empty

emptySimulatorContext :: MemPeerDBEnv -> SimulatorContext
emptySimulatorContext memPeerDBEnv =
  SimulatorContext
    { _simulatorContextWorldBestBlock = WorldBestBlock (BestBlock zeroHash 0)
    , _simulatorContextBestSequencedBlock = BestSequencedBlock zeroHash 0 []
    , _simulatorContextBestBlock = BestBlock zeroHash 0
    , _simulatorContextCanonicalBlockHashMap = M.empty
    , _simulatorContextBlockRegistry = M.empty
    , _simulatorContextDBERegistry = M.empty
    , _simulatorContextX509CertMap = M.empty
    , _simulatorContextPeerMap = memPeerDBEnv
    , _simulatorContextTransactionResults = []
    , _simulatorContextSyncStatus = SyncStatus True
    , _simulatorContextSyncTasks = []
    , _simulatorContextMemContextDBs = def
    }

createSimulatorPeer ::
  PrivateKey ->
  TVar Internet ->
  Host ->
  TCPPort ->
  UDPPort ->
  [Host] ->
  IO SimulatorPeer
createSimulatorPeer privKey inet ipAsText tcpPort udpPort bootNodes = do
  memPeerDBEnv <- createMemPeerDBEnv ipAsText $ map (\ip -> buildPeer (Nothing, ip, 30303)) bootNodes
  (u, c) <- atomically $ do
    tcpVSock <- newTQueue
    udpVSock <- newTQueue
    ctx <- newTVar $ emptySimulatorContext memPeerDBEnv
    modifyTVar inet $ tcpPorts . at (ipAsText, tcpPort) ?~ tcpVSock
    modifyTVar inet $ udpPorts . at (ipAsText, udpPort) ?~ udpVSock
    pure (udpVSock, ctx)
  pure $ SimulatorPeer privKey ipAsText inet u c

sockAddrToIpAndPort :: SockAddr -> Maybe (Host, UDPPort)
sockAddrToIpAndPort (SockAddrInet port host) = case hostAddressToTuple host of
  (a, b, c, d) ->
    let ipStr =
          concat
            [ show a,
              ".",
              show b,
              ".",
              show c,
              ".",
              show d
            ]
        ip = Host $ T.pack ipStr
        udpPort = UDPPort $ fromIntegral port
     in Just (ip, udpPort)
sockAddrToIpAndPort _ = Nothing

ipAndPortToSockAddr :: Host -> UDPPort -> Maybe SockAddr
ipAndPortToSockAddr (Host ip) (UDPPort port) =
  case traverse readMaybe (T.unpack <$> T.splitOn "." ip) of
    Just [(a :: Int), b, c, d] ->
      let addr =
            (fromIntegral a)
              .|. (fromIntegral b `shiftL` 8)
              .|. (fromIntegral c `shiftL` 16)
              .|. (fromIntegral d `shiftL` 24)
       in Just $ SockAddrInet (fromIntegral port) addr
    _ -> Nothing