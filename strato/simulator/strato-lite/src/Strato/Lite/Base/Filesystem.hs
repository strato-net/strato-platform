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
import Blockchain.Context hiding (actionTimestamp, blockHeaders, remainingBlockHeaders)
import Blockchain.P2PUtil (sockAddrToIP)
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Secp256k1
import Conduit
import Control.Lens hiding (Context, view)
import Control.Monad (void)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Reader
import Crypto.Types.PubKey.ECC
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.Conduit.Network
import qualified Data.Text as T
import Network.Socket
import qualified Network.Socket.ByteString as NB
import Network.Wai.Handler.Warp.Internal
import Strato.Lite.Base
import UnliftIO
import Prelude hiding (round)

data FilesystemPeer = FilesystemPeer
  { _filesystemPeerPrivKey     :: PrivateKey
  , _filesystemPeerTCPPort     :: TCPPort
  , _filesystemPeerUDPPort     :: UDPPort
  , _filesystemPeerUDPSocket   :: Socket
--   , _filesystemVMContext       :: Context
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

instance {-# OVERLAPPING #-} MonadIO m => A.Selectable (Host, UDPPort, B.ByteString) Point (FilesystemT m) where
  select p = liftIO . A.select p

createFilesystemPeer ::
  PrivateKey ->
  TCPPort ->
  UDPPort ->
  Socket ->
  FilesystemPeer
createFilesystemPeer = FilesystemPeer

-- instance {-# OVERLAPPING #-} MonadIO m => A.Selectable (Maybe Host, UDPPort) SockAddr (FilesystemT m) where
--   select _ (Just ip, udpPort) = pure $ ipAndPortToSockAddr ip udpPort
--   select _ (Nothing, udpPort) = do
--     myIP <- asks _filesystemPeerIPAddress
--     pure $ ipAndPortToSockAddr myIP udpPort
-- 
-- instance {-# OVERLAPPING #-} MonadUnliftIO m => A.Selectable () (B.ByteString, SockAddr) (FilesystemT m) where
--   select _ _ = do
--     s <- asks _filesystemMyUDPSocket
--     mMsg <- timeout 10000000 . atomically $ readTQueue s
--     pure mMsg
-- 
-- instance {-# OVERLAPPING #-} (MonadUnliftIO m, MonadLogger m) => A.Selectable (Host, UDPPort, B.ByteString) Point (FilesystemT m) where
--   select _ (ip@(Host ip'), port@(UDPPort p), bs) = do
--     inet <- asks _filesystemPeerInternet
--     mSock <- M.lookup (ip, port) . _udpPorts <$> readTVarIO inet
--     myIP@(Host myip) <- asks _filesystemPeerIPAddress
--     case mSock of
--       Nothing -> do
--         $logWarnS "getPubKey" $ "No socket exists for " <> ip' <> ":" <> T.pack (show p)
--         pure Nothing
--       Just s -> do
--         myS <- asks _filesystemMyUDPSocket
--         case ipAndPortToSockAddr myIP (UDPPort 30303) of
--           Nothing -> do
--             $logWarnS "strato-lite/getPubKey" $ "Could not get SockAddr for our IP address: " <> myip <> ":" <> T.pack (show p)
--             pure Nothing
--           Just addr -> do
--             atomically $ writeTQueue s (bs, addr)
--             mResp <- timeout 5000000 . atomically $ readTQueue myS
--             pure $ secPubKeyToPoint . processDataStream' . fst <$> mResp
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` OutputBlock) (FilesystemT m) where
--   lookup _ k = do
--     ctx <- asks _filesystemPeerContext
--     M.lookup k . _filesystemContextBlockRegistry <$> atomically (readTVar ctx)
--   insert _ k p = do
--     ctx <- asks _filesystemPeerContext
--     atomically . modifyTVar ctx $ (filesystemContextBlockRegistry . at k ?~ p)
--   delete _ k = do
--     ctx <- asks _filesystemPeerContext
--     atomically . modifyTVar ctx $ filesystemContextBlockRegistry . at k .~ Nothing
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible TCPPort (FilesystemT m) where
--   access _ = pure $ TCPPort 30303
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible UDPPort (FilesystemT m) where
--   access _ = pure $ UDPPort 30303
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => (FilesystemT m) `Mod.Yields` DataDefs.TransactionResult where
--   yield txr = filesystemContextTransactionResults %= (txr:)
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` API OutputTx) (FilesystemT m) where
--   lookup _ _ = pure Nothing
--   delete _ _ = pure ()
--   insert _ _ _ = pure ()
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` API OutputBlock) (FilesystemT m) where
--   lookup _ k   = fmap API <$> A.lookup (A.Proxy @OutputBlock) k
--   insert _ k v = A.insert (A.Proxy @OutputBlock) k $ unAPI v
--   delete _ k   = A.delete (A.Proxy @OutputBlock) k
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` P2P OutputBlock) (FilesystemT m) where
--   lookup _ k   = fmap P2P <$> A.lookup (A.Proxy @OutputBlock) k
--   insert _ k (P2P v) = do
--     A.insert (A.Proxy @OutputBlock) k v
--     filesystemContextCanonicalBlockHashMap . at (number $ obBlockData v) ?= Canonical k
--   delete _ k   = A.delete (A.Proxy @OutputBlock) k
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable (P2P BestBlock) (FilesystemT m) where
--   get _ = liftIO . throwIO $ Lookup "P2P" "()" "BestBlock"
--   put _ (P2P bb) = filesystemContextBestBlock .= bb
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => (Address `A.Alters` X509CertInfoState) (FilesystemT m) where
--   lookup _ k = do
--     ctx <- asks _filesystemPeerContext
--     M.lookup k . _filesystemContextX509CertMap <$> atomically (readTVar ctx)
--   lookupMany _ ks = do
--     ctx <- asks _filesystemPeerContext
--     atomically $ do
--       m <- _filesystemContextX509CertMap <$> readTVar ctx
--       pure . M.fromList . catMaybes $ (\k -> (k,) <$> M.lookup k m) <$> ks
--   insert _ k v = do
--     ctx <- asks _filesystemPeerContext
--     atomically . modifyTVar ctx $ filesystemContextX509CertMap . at k ?~ v
--   insertMany _ kvs = do
--     ctx <- asks _filesystemPeerContext
--     atomically . modifyTVar ctx $ filesystemContextX509CertMap %~ M.union kvs
--   delete _ k = do
--     ctx <- asks _filesystemPeerContext
--     atomically . modifyTVar ctx $ filesystemContextX509CertMap . at k .~ Nothing
--   deleteMany _ ks = do
--     ctx <- asks _filesystemPeerContext
--     atomically . modifyTVar ctx $ filesystemContextX509CertMap %~ flip M.difference (M.fromList . zip ks $ repeat ())
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => A.Selectable Validator X509CertInfoState (FilesystemT m) where
--   select _ (Validator k) = do
--     ctx <- asks _filesystemPeerContext
--     atomically $ listToMaybe . filter ((== k) . T.pack . commonName) . M.elems . _filesystemContextX509CertMap <$> readTVar ctx
--   selectMany _ ks = do
--     ctx <- asks _filesystemPeerContext
--     atomically $ do
--       m <- M.fromList . map (\(_,v) -> (Validator . T.pack $ commonName v, v)) . M.toList . _filesystemContextX509CertMap <$> readTVar ctx
--       pure . M.fromList . catMaybes $ (\k -> (k,) <$> M.lookup k m) <$> ks
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` DBDB.DependentBlockEntry) (FilesystemT m) where
--   lookup _ k = do
--     ctx <- asks _filesystemPeerContext
--     M.lookup k . _filesystemContextDBERegistry <$> atomically (readTVar ctx)
--   insert _ k v = do
--     ctx <- asks _filesystemPeerContext
--     atomically . modifyTVar ctx $ filesystemContextDBERegistry . at k ?~ v
--   delete _ k = do
--     ctx <- asks _filesystemPeerContext
--     atomically . modifyTVar ctx $ filesystemContextDBERegistry . at k .~ Nothing
-- 
-- updateSyncStatus :: MonadIO m => FilesystemT m ()
-- updateSyncStatus = do
--   nodeNumber <- bestBlockNumber <$> Mod.get (Mod.Proxy @BestBlock)
--   worldNumber <- bestBlockNumber . unWorldBestBlock <$> Mod.get (Mod.Proxy @WorldBestBlock)
--   Mod.put (Mod.Proxy @SyncStatus) $ SyncStatus (nodeNumber >= worldNumber)
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable WorldBestBlock (FilesystemT m) where
--   get _ = use filesystemContextWorldBestBlock
--   put _ wbb = do
--     assign filesystemContextWorldBestBlock wbb
--     updateSyncStatus
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe WorldBestBlock) (FilesystemT m) where
--   access _ = Just <$> use filesystemContextWorldBestBlock
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable BestBlock (FilesystemT m) where
--   get _ = use filesystemContextBestBlock
--   put _ bb = do
--     assign filesystemContextBestBlock bb
--     updateSyncStatus
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe BestBlock) (FilesystemT m) where
--   access _ = Just <$> use filesystemContextBestBlock
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable BestSequencedBlock (FilesystemT m) where
--   get _ = use filesystemContextBestSequencedBlock
--   put _ bsb = do
--     assign filesystemContextBestSequencedBlock bsb
--     updateSyncStatus
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe BestSequencedBlock) (FilesystemT m) where
--   access _ = Just <$> use filesystemContextBestSequencedBlock
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible [Validator] (FilesystemT m) where
--   access _ = do
--     bestSequencedBlock <- Mod.get (Mod.Proxy @BestSequencedBlock)
--     pure $ bestSequencedBlockValidators bestSequencedBlock
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable SyncStatus (FilesystemT m) where
--   get _ = use filesystemContextSyncStatus
--   put _ = assign filesystemContextSyncStatus
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible (Maybe SyncStatus) (FilesystemT m) where
--   access _ = Just <$> use filesystemContextSyncStatus
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => A.Selectable Integer (Canonical BlockHeader) (FilesystemT m) where
--   select _ i = M.lookup i <$> use filesystemContextCanonicalBlockHashMap >>= \case
--     Nothing -> pure Nothing
--     Just (Canonical bh) -> fmap (Canonical . obBlockData) <$> A.lookup (A.Proxy @OutputBlock) bh
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => A.Replaceable Integer (Canonical BlockHeader) (FilesystemT m) where
--   replace _ i (Canonical b) = filesystemContextCanonicalBlockHashMap . at i ?= (Canonical $ blockHeaderHash b)
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => GetLastBlocks (FilesystemT m) where
--   getLastBlocks n = do
--     lastBlockHashes <- map (unCanonical . snd) . take (fromInteger n) . sortOn (Down . fst) . M.toList <$> use filesystemContextCanonicalBlockHashMap
--     ctx <- asks _filesystemPeerContext
--     bhr <- _filesystemContextBlockRegistry <$> atomically (readTVar ctx)
--     pure . catMaybes $ fmap outputBlockToBlock . flip M.lookup bhr <$> lastBlockHashes
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => GetLastTransactions (FilesystemT m) where
--   getLastTransactions _ n = do
--     lastBlockHashes <- map (unCanonical . snd) . sortOn (Down . fst) . M.toList <$> use filesystemContextCanonicalBlockHashMap
--     ctx <- asks _filesystemPeerContext
--     bhr <- _filesystemContextBlockRegistry <$> atomically (readTVar ctx)
--     time <- liftIO getCurrentTime
--     let toRawTx blkNum OutputTx{..} = txAndTime2RawTX otOrigin otBaseTx blkNum time
--         getRawTxs OutputBlock{..} = toRawTx (blockHeaderBlockNumber obBlockData) <$> reverse obReceiptTransactions
--     pure . take (fromInteger n) . concat . catMaybes $ fmap getRawTxs . flip M.lookup bhr <$> lastBlockHashes
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => A.Selectable AccountsFilterParams [DataDefs.AddressStateRef] (FilesystemT m) where
--   -- TODO: Add AddressStateRef map to filesystemContext
--   select _ _ = pure Nothing -- AccountsFilterParams{..} = case _qaAddress of
--     -- Nothing -> pure $ Just []
--     -- Just addr -> do
--     --   bh <- bestBlockHash <$> use filesystemContextBestBlock
--     --   withCurrentBlockHash bh $ A.lookup (A.Proxy @AddressState) addr >>= \case
--     --     Nothing -> pure $ Just []
--     --     Just AddressState{..} -> do
--     --       let (mCH, mCN, mCPA) = case addressStateCodeHash of
--     --             ExternallyOwned h -> (Just h, Nothing, Nothing) 
--     --             SolidVMCode n h   -> (Just h, Just n, Nothing)
--     --             CodeAtAccount a n -> (Nothing, Just n, Just a)
--     --       pure . Just . (:[]) $ DataDefs.AddressStateRef
--     --         { DataDefs.addressStateRefAddress = addr
--     --         , DataDefs.addressStateRefNonce = addressStateNonce
--     --         , DataDefs.addressStateRefBalance = addressStateBalance
--     --         , DataDefs.addressStateRefContractRoot = addressStateContractRoot
--     --         , DataDefs.addressStateRefCodeHash = mCH
--     --         , DataDefs.addressStateRefContractName = mCN
--     --         , DataDefs.addressStateRefCodePtrAddress = mCPA
--     --         , DataDefs.addressStateRefLatestBlockDataRefNumber = -1
--     --         }
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => A.Selectable BlocksFilterParams [Block] (FilesystemT m) where
--   select _ _ = Just <$> getLastBlocks 1000
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => A.Selectable StorageFilterParams [StorageAddress] (FilesystemT m) where
--   select _ _ = pure $ Just []
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => A.Selectable TxsFilterParams [DataDefs.RawTransaction] (FilesystemT m) where
--   select _ tfp = case qtHash tfp of
--     Nothing -> Just <$> getLastTransactions Nothing 1000
--     Just h -> do
--       time <- liftIO getCurrentTime
--       let toRawTx OutputTx{..} = txAndTime2RawTX otOrigin otBaseTx (-1) time
--       ctx <- asks _filesystemPeerContext
--       bhr <- _filesystemContextBlockRegistry <$> atomically (readTVar ctx)
--       let blockTxs = map toRawTx . concatMap obReceiptTransactions $ M.elems bhr
--       pure . Just . filter (\r -> DataDefs.rawTransactionTxHash r == h) $ blockTxs
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => A.Selectable Keccak256 [DataDefs.TransactionResult] (FilesystemT m) where
--   select _ h = Just . filter ((==) h . DataDefs.transactionResultTransactionHash) <$> use filesystemContextTransactionResults
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible TransactionCount (FilesystemT m) where
--   access _ = do
--     ctx <- asks _filesystemPeerContext
--     bhr <- _filesystemContextBlockRegistry <$> atomically (readTVar ctx)
--     pure . TransactionCount . fromIntegral . length . concat . map obReceiptTransactions $ M.elems bhr
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => HasSyncDB (FilesystemT m) where
--   clearAllSyncTasks host = filesystemContextSyncTasks %= map (\st@(SyncTask i t h s) -> if h == host then SyncTask i t (Host "") s else st)
--   getCurrentSyncTask host = do
--     let assignedByHost (SyncTask _ _ h s) = h == host && s == Assigned
--     tasks <- filter assignedByHost <$> use filesystemContextSyncTasks
--     case tasks of
--       [t] -> pure $ Just t
--       [] -> pure Nothing
--       _ -> error $ "multiple sync tasks found in call to getCurrentSyncTask:\n" ++ unlines (show <$> tasks)
--   getNewSyncTask "127.0.0.1" _ = pure Nothing
--   getNewSyncTask host _ = do -- TODO: Figure out what highestBlockNum (second parameter) is used for
--     now <- liftIO getCurrentTime
--     let oneMinuteAgo = addUTCTime (-60) now
--     unsortedTasks <- use filesystemContextSyncTasks
--     let sortedTasks = sortOn (\(SyncTask _ t _ _) -> t) unsortedTasks
--         foldTasks (Nothing, tasks) st@(SyncTask i t _ s) =
--           if t < oneMinuteAgo && s /= Finished
--             then let newTask = SyncTask i now host s
--                   in (Just newTask, newTask:tasks)
--             else (Nothing, st:tasks)
--         foldTasks (newTask, tasks) st = (newTask, st:tasks)
--         (mNewTask, updatedTasks) = foldl' foldTasks (Nothing, []) sortedTasks
--     case mNewTask of
--       Nothing -> do
--         let newTask = SyncTask (maximum (0:((\(SyncTask i _ _ _) -> i) <$> updatedTasks))) now host Assigned
--         filesystemContextSyncTasks .= newTask : updatedTasks
--         pure $ Just newTask
--       Just newTask -> do
--         filesystemContextSyncTasks .= updatedTasks
--         pure $ Just newTask
--   setSyncTaskFinished host = filesystemContextSyncTasks %= map (\st@(SyncTask i t h _) -> if h == host then SyncTask i t h Finished else st)
--   setSyncTaskNotReady host = filesystemContextSyncTasks %= map (\st@(SyncTask i t h s) -> if h == host && s == Assigned then SyncTask i t h NotReady else st)
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable BlockHashRoot (FilesystemT m) where
--   get _ = dbsGets $ Lens.view blockHashRoot
--   put _ bhr = dbsModify' $ blockHashRoot .~ bhr
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable GenesisRoot (FilesystemT m) where
--   get _ = dbsGets $ Lens.view genesisRoot
--   put _ gr = dbsModify' $ genesisRoot .~ gr
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => Mod.Modifiable BestBlockRoot (FilesystemT m) where
--   get _ = dbsGets $ Lens.view bestBlockRoot
--   put _ bbr = dbsModify' $ bestBlockRoot .~ bbr
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => (MP.StateRoot `A.Alters` MP.NodeData) (FilesystemT m) where
--   lookup _ sr = dbsGets $ Lens.view (stateDB . at sr)
--   insert _ sr nd = dbsModify' $ stateDB . at sr ?~ nd
--   delete _ sr = dbsModify' $ stateDB . at sr .~ Nothing
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` DBCode) (FilesystemT m) where
--   lookup _ k = dbsGets $ Lens.view (codeDB . at k)
--   insert _ k c = dbsModify' $ codeDB . at k ?~ c
--   delete _ k = dbsModify' $ codeDB . at k .~ Nothing
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => (N.NibbleString `A.Alters` N.NibbleString) (FilesystemT m) where
--   lookup _ n1 = dbsGets $ Lens.view (hashDB . at n1)
--   insert _ n1 n2 = dbsModify' $ hashDB . at n1 ?~ n2
--   delete _ n1 = dbsModify' $ hashDB . at n1 .~ Nothing
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` BlockSummary) (FilesystemT m) where
--   lookup _ k = dbsGets $ Lens.view (blockSummaryDB . at k)
--   insert _ k bs = dbsModify' $ blockSummaryDB . at k ?~ bs
--   delete _ k = dbsModify' $ blockSummaryDB . at k .~ Nothing
-- 
-- sockAddrToIpAndPort :: SockAddr -> Maybe (Host, UDPPort)
-- sockAddrToIpAndPort (SockAddrInet port host) = case hostAddressToTuple host of
--   (a, b, c, d) ->
--     let ipStr =
--           concat
--             [ show a,
--               ".",
--               show b,
--               ".",
--               show c,
--               ".",
--               show d
--             ]
--         ip = Host $ T.pack ipStr
--         udpPort = UDPPort $ fromIntegral port
--      in Just (ip, udpPort)
-- sockAddrToIpAndPort _ = Nothing
-- 
-- ipAndPortToSockAddr :: Host -> UDPPort -> Maybe SockAddr
-- ipAndPortToSockAddr (Host ip) (UDPPort port) =
--   case traverse readMaybe (T.unpack <$> T.splitOn "." ip) of
--     Just [(a :: Int), b, c, d] ->
--       let addr =
--             (fromIntegral a)
--               .|. (fromIntegral b `shiftL` 8)
--               .|. (fromIntegral c `shiftL` 16)
--               .|. (fromIntegral d `shiftL` 24)
--        in Just $ SockAddrInet (fromIntegral port) addr
--     _ -> Nothing
-- 
-- instance HasContext m => Mod.Modifiable BlockHashRoot m where
--   get _ = do
--     db <- getStateDB
--     BlockHashRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get db def vmBlockHashRootKey
--   put _ (BlockHashRoot (MP.StateRoot sr)) = do
--     db <- getStateDB
--     DB.put db def vmBlockHashRootKey sr
-- 
-- instance HasContext m => Mod.Modifiable GenesisRoot m where
--   get _ = do
--     db <- getStateDB
--     GenesisRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get db def vmGenesisRootKey
--   put _ (GenesisRoot (MP.StateRoot sr)) = do
--     db <- getStateDB
--     DB.put db def vmGenesisRootKey sr
-- 
-- instance HasContext m => Mod.Modifiable BestBlockRoot m where
--   get _ = do
--     db <- getStateDB
--     BestBlockRoot . maybe MP.emptyTriePtr MP.StateRoot <$> DB.get db def vmBestBlockRootKey
--   put _ (BestBlockRoot (MP.StateRoot sr)) = do
--     db <- getStateDB
--     DB.put db def vmBestBlockRootKey sr
-- 
-- instance HasContext m => Mod.Modifiable CurrentBlockHash m where
--   get _ = fmap (fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0)) . gets $ view $ memDBs . currentBlock
--   put _ bh = modify $ memDBs . currentBlock ?~ bh
-- 
-- instance HasContext m => HasMemAddressStateDB m where
--   getAddressStateTxDBMap = gets $ view $ memDBs . stateTxMap
--   putAddressStateTxDBMap theMap = modify $ memDBs . stateTxMap .~ theMap
--   getAddressStateBlockDBMap = gets $ view $ memDBs . stateBlockMap
--   putAddressStateBlockDBMap theMap = modify $ memDBs . stateBlockMap .~ theMap
-- 
-- instance MonadUnliftIO m => (MP.StateRoot `A.Alters` MP.NodeData) (ReaderT Context m) where
--   lookup _ = MP.genericLookupDB $ getStateDB
--   insert _ = MP.genericInsertDB $ getStateDB
--   delete _ = MP.genericDeleteDB $ getStateDB
-- 
-- instance (MonadLogger m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => (Address `A.Alters` AddressState) m where
--   lookup _ = getAddressStateMaybe
--   insert _ = putAddressState
--   delete _ = deleteAddressState
-- 
-- instance {-# OVERLAPPING #-} (MonadLogger m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => A.Selectable Address AddressState m where
--   select _ = getAddressStateMaybe
-- 
-- instance (MonadLogger m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => (Maybe Word256 `A.Alters` MP.StateRoot) m where
--   lookup _ chainId = do
--     mBH <- gets $ view $ memDBs . currentBlock
--     fmap join . for mBH $ \(CurrentBlockHash bh) -> do
--       mSR <- gets $ view $ memDBs . stateRoots . at (bh, chainId)
--       case mSR of
--         Just sr -> pure $ Just sr
--         Nothing -> getChainStateRoot chainId bh
--   insert _ chainId sr = do
--     mBH <- gets $ view $ memDBs . currentBlock
--     case mBH of
--       Nothing -> pure ()
--       Just (CurrentBlockHash bh) -> do
--         modify $ memDBs . stateRoots %~ M.insert (bh, chainId) sr
--         putChainStateRoot chainId bh sr
--   delete _ chainId = do
--     mBH <- gets $ view $ memDBs . currentBlock
--     case mBH of
--       Nothing -> pure ()
--       Just (CurrentBlockHash bh) -> do
--         modify $ memDBs . stateRoots %~ M.delete (bh, chainId)
--         deleteChainStateRoot chainId bh
-- 
-- instance HasContext m => (Keccak256 `A.Alters` DBCode) m where
--   lookup _ = genericLookupCodeDB $ getCodeDB
--   insert _ = genericInsertCodeDB $ getCodeDB
--   delete _ = genericDeleteCodeDB $ getCodeDB
-- 
-- instance (MonadLogger m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => ((Address, T.Text) `A.Selectable` X509CertificateField) m where
--   select _ (k, t) = do
--     let certKey addr = (addr,) . Text.encodeUtf8
--     mCertAddress <- lookupX509AddrFromCBHash k
--     fmap join . for mCertAddress $ \certAddress -> do
--       maybe Nothing (readMaybe . T.unpack . Text.decodeUtf8) <$> A.lookup (A.Proxy) (certKey certAddress t)
-- 
-- instance (MonadLogger m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => (Address `A.Selectable` X509Certificate) m where
--   select _ k = do
--     let certKey addr = (addr,) . Text.encodeUtf8
--     mCertAddress <- lookupX509AddrFromCBHash k
--     fmap join . for mCertAddress $ \certAddress -> do
--       mBString <- fmap (rlpDecode . rlpDeserialize) <$> A.lookup (A.Proxy) (certKey certAddress ".certificateString")
--       case mBString of
--         Just (BString bs) -> pure . eitherToMaybe $ bytesToCert bs
--         _ -> pure Nothing
-- 
-- 
-- instance HasContext m => (N.NibbleString `A.Alters` N.NibbleString) m where
--   lookup _ = genericLookupHashDB $ getHashDB
--   insert _ = genericInsertHashDB $ getHashDB
--   delete _ = genericDeleteHashDB $ getHashDB
-- 
-- instance (HasContext m) => HasMemRawStorageDB m where
--   getMemRawStorageTxDB = gets $ view $ memDBs . storageTxMap
--   putMemRawStorageTxMap theMap = modify $ memDBs . storageTxMap .~ theMap
--   getMemRawStorageBlockDB = gets $ view $ memDBs . storageBlockMap
--   putMemRawStorageBlockMap theMap = modify $ memDBs . storageBlockMap .~ theMap
-- 
-- instance (MonadLogger m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => (RawStorageKey `A.Alters` RawStorageValue) m where
--   lookup _ = genericLookupRawStorageDB
--   insert _ = genericInsertRawStorageDB
--   delete _ = genericDeleteRawStorageDB
--   lookupWithDefault _ = genericLookupWithDefaultRawStorageDB
-- 
-- instance HasContext m => (Keccak256 `A.Alters` BlockSummary) m where
--   lookup _ = genericLookupBlockSummaryDB $ getBlockSummaryDB
--   insert _ = genericInsertBlockSummaryDB $ getBlockSummaryDB
--   delete _ = genericDeleteBlockSummaryDB $ getBlockSummaryDB
-- 
-- instance HasContext m => Mod.Accessible SQLDB m where
--   access _ = fmap (view (dbs.sqldb)) accessEnv
-- 
-- instance HasContext m => Mod.Accessible RBDB.RedisConnection m where
--   access _ = fmap (view $ dbs . redisPool) accessEnv
-- 
-- instance (MonadIO m, Mod.Accessible RBDB.RedisConnection m) => Mod.Accessible (Maybe WorldBestBlock) m where
--   access _ = do
--     mRBB <- RBDB.withRedisBlockDB getWorldBestBlockInfo
--     for mRBB $ \(BestBlock sha num) ->
--       return . WorldBestBlock $ BestBlock sha num
-- 
-- instance (MonadLogger m, HasContext m) => Mod.Modifiable GasCap m where
--   get _ = contextGets (GasCap . _vmGasCap)
-- 
--   put _ (GasCap g) = do
--     contextModify (vmGasCap .~ g)
--     $logDebugS "#### Mod.put @vmGasCap" . T.pack $ "VM Gas Cap updated to: " ++ show g