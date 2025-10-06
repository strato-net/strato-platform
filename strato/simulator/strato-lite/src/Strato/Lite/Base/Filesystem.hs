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
import BlockApps.Solidity.Value as V
import BlockApps.X509.Certificate
import Blockchain.Context hiding (actionTimestamp, blockHeaders, remainingBlockHeaders)
import Blockchain.Data.Block
import Blockchain.Data.BlockDB
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockSummary
import Blockchain.Data.CirrusDefs
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Data.Transaction
import Blockchain.Data.TransactionResult
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.P2PUtil (sockAddrToIP)
import Blockchain.DBM
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.ChainDB
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.SQLDB
import Blockchain.Model.SyncState
import Blockchain.Model.SyncTask
import Blockchain.Model.WrappedBlock
import qualified Blockchain.Sequencer.DB.DependentBlockDB as DBDB
import Blockchain.Slipstream.OutputData
import Blockchain.Slipstream.QueryFormatHelper
import Blockchain.Strato.Indexer.IContext (API (..), IndexerException (..), P2P (..))
import Blockchain.Strato.Discovery.ContextLite (UDPPacket(..))
import Blockchain.Strato.Discovery.Data.MemPeerDB
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Blockchain.Strato.StateDiff (StateDiff)
import Blockchain.Strato.StateDiff.Database (commitSqlDiffs)
import Blockchain.SyncDB
import Conduit
import Control.Lens hiding (Context, view)
import Control.Monad (void)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base
import Control.Monad.Reader
import qualified Control.Monad.State as State
import Core.API
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.Conduit.Network
import Data.Default
import Data.Foldable (for_, traverse_)
import qualified Data.Map.Strict as M
import Data.List (foldl', sortOn)
import Data.Maybe (fromMaybe) -- (catMaybes, fromMaybe)
import qualified Data.NibbleString as N
-- import Data.Ord (Down(..))
import qualified Data.Text as T
import Data.Text.Encoding (encodeUtf8)
import Data.Time.Clock (addUTCTime, getCurrentTime)
import qualified Database.LevelDB as LDB
import qualified Database.Persist.Sql as SQL
import Debugger (SourceMap(..))
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
  , _sqlPool :: SQL.ConnectionPool
  }

makeLenses ''FilesystemDBs

data FilesystemPeer = FilesystemPeer
  { _filesystemPeerPrivKey     :: PrivateKey
  , _filesystemPeerTCPPort     :: TCPPort
  , _filesystemPeerUDPPort     :: UDPPort
  , _filesystemPeerUDPSocket   :: Socket
  , _filesystemPeerMap         :: MemPeerDBEnv
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

instance {-# OVERLAPPING #-} MonadIO m => RunsServer (FilesystemT m) where
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

instance {-# OVERLAPPING #-} MonadIO m => Mod.Awaitable UDPPacket (FilesystemT m) where
  await = do
    s <- asks _filesystemPeerUDPSocket
    fmap (fmap UDPPacket) . liftIO . timeout 10000000 $ NB.recvFrom s 80000

createFilesystemPeer ::
  PrivateKey ->
  TCPPort ->
  UDPPort ->
  Socket ->
  MemPeerDBEnv ->
  FilesystemDBs ->
  STM FilesystemPeer
createFilesystemPeer p t u s m d = flip (FilesystemPeer p t u s m) d <$> newTVar []

createFilesystemPeerIO ::
  PrivateKey ->
  TCPPort ->
  UDPPort ->
  Socket ->
  Host ->
  [Host] ->
  FilesystemDBs ->
  IO FilesystemPeer
createFilesystemPeerIO p t u s h bs d = do
  m <- createMemPeerDBEnv h (buildPeer . (\b -> (Nothing, b, 30303)) <$> bs)
  atomically $ createFilesystemPeer p t u s m d

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible TCPPort (FilesystemT m) where
  access _ = asks _filesystemPeerTCPPort

instance {-# OVERLAPPING #-} MonadIO m => Mod.Accessible UDPPort (FilesystemT m) where
  access _ = asks _filesystemPeerUDPPort

instance {-# OVERLAPPING #-} MonadUnliftIO m => (FilesystemT m) `Mod.Yields` DataDefs.TransactionResult where
  yield = void . putTransactionResults . (:[])

instance {-# OVERLAPPING #-} (MonadUnliftIO m, MonadLogger m) => (FilesystemT m) `Mod.Outputs` StateDiff where
  output = commitSqlDiffs

instance {-# OVERLAPPING #-} (MonadUnliftIO m, MonadLogger m) => (FilesystemT m) `Mod.Outputs` SlipstreamQuery where
  output slipstreamQuery = for_ (slipstreamQuerySQLite slipstreamQuery) $ \cmd -> do
    pool <- asks $ _sqlPool . _filesystemDBs
    traverse_ ($logDebugS ("slipstream/cmds")) $ T.lines cmd
    liftIO . loggingFunc $ flip SQL.runSqlPool pool $ catch
      (void $ SQL.rawExecute (T.intercalate " " (T.lines cmd)) [])
      (\(e :: SomeException) -> do
        $logErrorS "slipstream/error" . T.pack $ show e
        traverse_ ($logErrorS "slipstream/error") $ T.lines cmd
      )

sqlTypeSQLite :: SqlType -> T.Text
sqlTypeSQLite SqlBool    = "bool"
sqlTypeSQLite SqlDecimal = "decimal"
sqlTypeSQLite SqlText    = "text"
sqlTypeSQLite SqlJsonb   = "jsonb"
sqlTypeSQLite SqlSerial  = ""

slipstreamQuerySQLite :: SlipstreamQuery -> Maybe T.Text
slipstreamQuerySQLite (CreateTable tableName cols pk mTC) = Just $ T.concat
  [ "CREATE TABLE IF NOT EXISTS "
  , tableNameToDoubleQuoteText tableName
  , " ("
  , csv $ (\(c,t) -> wrapEscapeDouble c <> " " <> sqlTypeSQLite t) <$> cols
  , case pk of
      [] -> ""
      _ -> ",\n  PRIMARY KEY " <> wrapAndEscapeDouble pk
  , case mTC of
      Just (Unique n uc) -> T.concat
        [ ", CONSTRAINT "
        , wrapEscapeDouble n
        , " UNIQUE "
        , uc
        ]
      _ -> ""
  , ");"
  ]
slipstreamQuerySQLite InsertTable{..} = Just $ T.concat
  [ "INSERT "
  , case onConflict of
      Just DoNothing -> "OR IGNORE "
      Just OnConflict{} -> "OR REPLACE "
      _ -> ""
  , "INTO "
  , tableNameToDoubleQuoteText tableName
  , " "
  , wrapAndEscapeDouble $ fst <$> tableColumns
  , "\n  VALUES "
  , csv $ wrapParens . csv . map
      (\((_,t),v) -> fromMaybe "NULL" $ valueToSQLiteText t =<< v)
      . zip tableColumns
      <$> values
  ]
slipstreamQuerySQLite _ = Nothing

valueToSQLiteText :: SqlType -> Value -> Maybe T.Text
valueToSQLiteText t v = case t of
  SqlJsonb -> (\w -> "jsonb(" <> wrapEscapeSingle w <> ")") <$> w'
  _ -> wrapEscapeSingle <$> valueToSQLText' True v
  where v' = valueToSQLText' True v
        w' = (\w -> case v of
            SimpleValue ValueString{} -> wrapEscapeDouble w
            SimpleValue ValueBytes{} -> wrapEscapeDouble w
            SimpleValue ValueAddress{} -> wrapEscapeDouble w
            SimpleValue ValueAccount{} -> wrapEscapeDouble w
            ValueContract{} -> wrapEscapeDouble w
            ValueArraySentinel _ -> "\"\""
            _ -> w
          ) <$> v'

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

instance {-# OVERLAPPING #-} MonadIO m => AccessibleEnv SQLDB (FilesystemT m) where
  accessEnv = asks $ SQLDB . _sqlPool . _filesystemDBs

instance {-# OVERLAPPING #-} MonadIO m => AccessibleEnv CirrusDB (FilesystemT m) where
  accessEnv = asks $ CirrusDB . _sqlPool . _filesystemDBs

instance {-# OVERLAPPING #-} MonadUnliftIO m => A.Selectable Address Certificate (FilesystemT m) where
  select _ = getX509CertForAccount

instance {-# OVERLAPPING #-} MonadUnliftIO m => (Keccak256 `A.Selectable` SourceMap) (FilesystemT m) where
  select _ = getCodeFromPostgres

instance {-# OVERLAPPING #-} MonadUnliftIO m => (Keccak256 `A.Alters` API OutputTx) (FilesystemT m) where
  lookup _ _ = liftIO . throwIO $ Lookup "API" "Keccak256" "OutputTx"
  delete _ _ = liftIO . throwIO $ Delete "API" "Keccak256" "OutputTx"
  insert _ _ (API OutputTx {..}) = void $ insertTX Log otOrigin Nothing [otBaseTx]

instance {-# OVERLAPPING #-} MonadUnliftIO m => (Keccak256 `A.Alters` API OutputBlock) (FilesystemT m) where
  lookup _ _ = liftIO . throwIO $ Lookup "API" "Keccak256" "OutputBlock"
  delete _ _ = liftIO . throwIO $ Delete "API" "Keccak256" "OutputBlock"
  insert _ _ (API ob) = void $ putBlocks [outputBlockToBlockRetainPayloads ob] False
  insertMany _ =
    void
      . flip putBlocks False
      . map (outputBlockToBlockRetainPayloads . unAPI)
      . M.elems

instance {-# OVERLAPPING #-} MonadIO m => (Keccak256 `A.Alters` P2P OutputBlock) (FilesystemT m) where
  lookup _ k         = fmap P2P <$> lookupLDB (_blockDB . _filesystemDBs) k
  insert _ k (P2P v) = do
    insertLDB (_blockDB . _filesystemDBs) k v
    insertLDB (_canonicalDB . _filesystemDBs) (number $ obBlockData v) k
    txCount <- fromMaybe 0 <$> lookupLDB (_kvDB . _filesystemDBs) (encodeUtf8 "transaction_count")
    insertLDB (_kvDB . _filesystemDBs) (encodeUtf8 "transaction_count") (txCount + length (obReceiptTransactions v))
    let bsb = BestSequencedBlock
                (headerHash $ obBlockData v)
                (number $ obBlockData v)
                (getBlockValidators $ obBlockData v)
    insertLDB (_kvDB . _filesystemDBs) (encodeUtf8 "best_sequenced_block") bsb
    updateSyncStatus'
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
  put _ _ = pure () -- do
    -- insertLDB (_kvDB . _filesystemDBs) (encodeUtf8 "best_sequenced_block") v
    -- updateSyncStatus'

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

-- instance {-# OVERLAPPING #-} MonadIO m => GetLastBlocks (FilesystemT m) where
--   getLastBlocks n = do
--     BestBlock _ i <- Mod.get (Mod.Proxy @BestBlock)
--     hashes :: [Keccak256] <- catMaybes <$> traverse (lookupLDB $ _canonicalDB . _filesystemDBs) [(max 0 (i-n))..i]
--     obs <- A.lookupMany (A.Proxy @OutputBlock) hashes
--     pure . map (outputBlockToBlock . snd) . sortOn (Down . fst) $ M.toList obs
-- 
-- instance {-# OVERLAPPING #-} MonadIO m => GetLastTransactions (FilesystemT m) where
--   getLastTransactions _ n = do
--     BestBlock _ i <- Mod.get (Mod.Proxy @BestBlock)
--     now <- liftIO getCurrentTime
--     let go :: Integer -> [(Integer, OutputTx)] -> Integer -> FilesystemT m [(Integer, OutputTx)]
--         go l ts j
--           | j <= 0 = pure ts
--           | otherwise = lookupLDB (_canonicalDB . _filesystemDBs) j >>= \case
--               Nothing -> go l ts (j - 1)
--               Just (bh :: Keccak256) -> A.lookup (A.Proxy @OutputBlock) bh >>= \case
--                 Nothing -> go l ts (j - 1)
--                 Just ob -> let !l' = l + fromIntegral (length (obReceiptTransactions ob))
--                                ts' = ts ++ ((number $ obBlockData ob,) <$> reverse (obReceiptTransactions ob))
--                             in if l' >= n then pure $ take (fromIntegral n) ts' else go l' ts' (j - 1)
--         toRawTx blkNum OutputTx{..} = txAndTime2RawTX otOrigin otBaseTx blkNum now
--     map (uncurry toRawTx) <$> go 0 [] i

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
  clearAllSyncTasks host = State.modify' $ filter (\(SyncTask _ _ h _) -> h /= host)
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
        let newTask = SyncTask (maximum (0:((\(SyncTask i _ _ _) -> i + 1) <$> updatedTasks))) now host Assigned
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
  lookup _ = MP.genericLookupDB . asks $ MP.unStateDB . _stateDB . _filesystemDBs
  insert _ = MP.genericInsertDB . asks $ MP.unStateDB . _stateDB . _filesystemDBs
  delete _ = MP.genericDeleteDB . asks $ MP.unStateDB . _stateDB . _filesystemDBs

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