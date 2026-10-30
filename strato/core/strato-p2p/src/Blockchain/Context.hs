{-# LANGUAGE BangPatterns          #-}
{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE DerivingStrategies    #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeFamilies          #-}
{-# LANGUAGE TypeOperators         #-}

module Blockchain.Context
    ( MonadP2P
    , Inbound(..)
    , Outbound(..)
    , Context(..)
    , Config(..)
    , P2pConduits(..)
    , peerSource
    , peerSink
    , seqSource
    , RunsClient(..)
    , RunsServer(..)
    , ActionTimestamp(..)
    , emptyActionTimestamp
    , PeerAddress(..)
    , GenesisBlockHash(..)
    , PeerRunner
    , RemainingBlockHeaders(..)
    , LastResync(..)
    , HasResyncGate(..)
    , initConfig
    , initContext
    , runContextM
    , ContextM(..)
    , ContextRow
    , blockstanbulPeerAddr
    , getBlockHeaders
    , putBlockHeaders
    , getRemainingBHeaders
    , putRemainingBHeaders
    , stampActionTimestamp
    , getActionTimestamp
    , clearActionTimestamp
    , getPeerByIP
    , getPeersByIP
    , setPeerAddrIfUnset
    , shouldSendToPeer
    , withActivePeer
    , withActiveInboundPeer
    ) where

import           Conduit
import           Control.Applicative
import           Control.Exception                       hiding (bracket, catch, throwIO)
import           Control.Lens                            hiding (Context)
import qualified Control.Monad.Change.Alter              as A
import qualified Control.Monad.Change.Modify             as Mod
import           Control.Monad.Catch                     (MonadCatch, MonadMask)
import           Control.Monad.Composable.Vault
import           Control.Monad.Reader
import           Crypto.Types.PubKey.ECC
import qualified Data.ByteString                         as B
import qualified Data.ByteString.Char8                   as BC
import           Data.Conduit.Network
import           Data.Default                            (def)
import           Data.Foldable                           (toList)
import qualified Data.Kind                               as DK
import           Data.Maybe
import           Data.Proxy
import qualified Data.Set.Ordered                        as S
import           Data.String
import qualified Data.Text                               as T
import           Data.Time.Clock
import           GHC.Exts                                (Constraint)

import           BlockApps.Logging

import           Blockchain.BlockDB                     (getCanonical, getHashesByNumber)
import           Blockchain.Blockstanbul                 (WireMessage)
import           Blockchain.Data.BlockHeader
import           Blockchain.DB.DetailsDB
import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           Blockchain.EthConf
import qualified Blockchain.EthConf.Model as Conf
import           Blockchain.Model.SyncState
import qualified Blockchain.Model.SyncTask               as SYNCTASK
import           Blockchain.P2PUtil
import           Blockchain.Sequencer.Event
import qualified Blockchain.Sequencer.Kafka              as SK

import           Control.Monad.Composable.Streaming      (StreamEnv,
                                                          createStreamEnv,
                                                          runStreamMUsingEnv)

import           Blockchain.Strato.Discovery.ContextLite ()
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Host
import           Blockchain.Strato.Model.Keccak256

import qualified Blockchain.Strato.RedisBlockDB          as RBDB
import           Blockchain.SyncDB
import           Control.Monad                           (unless, void, when)
import           Control.Monad.Composable.Base
import           Control.Monad.Composable.BlockDB (BlockDBEnv, HasBlockDB, runBlockDB)
import qualified Database.Persist.Sql                    as SQL
import qualified Database.Redis                          as Redis
import           Network.Wai.Handler.Warp.Internal       (setSocketCloseOnExec)
import           Text.Read                               (readMaybe)
import           UnliftIO

-- TODO: These type families should be exposed by monad-alter, not defined here
--       but merging in the latest monad-alter will take some additional work
type family All' (k :: DK.Type -> (DK.Type -> DK.Type) -> Constraint) (ts :: [DK.Type]) (m :: DK.Type -> DK.Type) :: Constraint where
  All' k (t : '[]) m = k t m
  All' k (t ': ts) m = (k t m, All' k ts m)

type family All (ks :: [DK.Type -> (DK.Type -> DK.Type) -> Constraint]) (ts :: [DK.Type]) (m :: DK.Type -> DK.Type) :: Constraint where
  All (k ': '[]) ts m = All' k ts m
  All (k ': ks) ts m = (All' k ts m, All ks ts m)

type family All2' (k :: DK.Type -> DK.Type -> (DK.Type -> DK.Type) -> Constraint) (ts :: [(DK.Type, DK.Type)]) (m :: DK.Type -> DK.Type) :: Constraint where
  All2' k ('(t1, t2) : '[]) m = k t1 t2 m
  All2' k ('(t1, t2) ': ts) m = (k t1 t2 m, All2' k ts m)

type family All2 (ks :: [DK.Type -> DK.Type -> (DK.Type -> DK.Type) -> Constraint]) (ts :: [(DK.Type, DK.Type)]) (m :: DK.Type -> DK.Type) :: Constraint where
  All2 (k ': '[]) ts m = All2' k ts m
  All2 (k ': ks) ts m = (All2' k ts m, All2 ks ts m)

newtype Inbound a = Inbound {unInbound :: a}

newtype Outbound a = Outbound {unOutbound :: a}

data Config = Config
  { configSQLDB                    :: SQLDB,
    -- | Peers and sync tasks; the eth pool itself on a monolith.
    configPeerDB                   :: SQLDB,
    configRedisBlockDB             :: RBDB.RedisConnection,
    configContext                  :: IORef Context,
    configBlockstanbulWireMessages :: IORef (S.OSet Keccak256),
    -- Per-connection Kafka producer, swapped in by the peer runner. Guarded by
    -- an MVar because milena's KafkaState read-modify-write in execKafka is not
    -- atomic across threads. It must NOT be shared process-wide: that made one
    -- lock serialize every peer's ToUnseq produces and starved block downloads.
    configStreamEnv                :: MVar StreamEnv,
    -- Process-wide, unlike the caches in Context. "Which block does the
    -- sequencer still need" is one node-wide fact, so the answer must be
    -- shared: when it was per-connection, a single gap made EVERY connection
    -- fetch the same 500-block range (measured: one range pulled 113 times by
    -- 113 different peer threads, 8.7x total duplication).
    configLastResync               :: IORef LastResync
  }

newtype ActionTimestamp = ActionTimestamp {unActionTimestamp :: Maybe UTCTime}

emptyActionTimestamp :: ActionTimestamp
emptyActionTimestamp = ActionTimestamp Nothing

newtype RemainingBlockHeaders = RemainingBlockHeaders {unRemainingBlockHeaders :: [BlockHeader]}

-- | Last missing-parent resync this connection asked for: (fetch number, when).
newtype LastResync = LastResync {unLastResync :: Maybe (Integer, UTCTime)}

newtype PeerAddress = PeerAddress {unPeerAddress :: Maybe Address}

withPeerAddress :: (Maybe Address -> Maybe Address) -> PeerAddress -> PeerAddress
withPeerAddress f = PeerAddress . f . unPeerAddress

data Context = Context
  { blockHeaders          :: ([BlockHeader], UTCTime) -- keep track when last updated global headers cache
  , remainingBlockHeaders :: (RemainingBlockHeaders, UTCTime) -- keep track when last updated global headers cache
  , actionTimestamp       :: ActionTimestamp
  , _blockstanbulPeerAddr :: PeerAddress
  , _outboundWireMessages :: S.OSet (Host, Keccak256)
  }

makeLenses ''Context

newtype GenesisBlockHash = GenesisBlockHash {unGenesisBlockHash :: Keccak256}

type ContextRow = '[BlockDBEnv, ReaderEnv Config, InternalState, VaultData, Logger]

newtype ContextM a = ContextM {unContextM :: Eff ContextRow a}
  deriving newtype (Functor, Applicative, Monad, MonadIO, MonadFail, MonadThrow, MonadCatch, MonadMask, MonadUnliftIO, MonadReader Config, MonadLogger, MonadLoggerIO, MonadResource, HasVault)
  deriving newtype (AccessibleEnv BlockDBEnv)

data P2pConduits m = P2pConduits
  { _peerSource :: ConduitM () B.ByteString m (),
    _peerSink   :: ConduitM B.ByteString Void m (),
    _seqSource  :: ConduitM () P2pEvent m ()
  }

makeLenses ''P2pConduits

class RunsClient m where
  runClientConnection ::
    Host ->
    TCPPort ->
    ConduitM () P2pEvent m () ->
    (P2pConduits m -> m ()) ->
    m ()

class RunsServer m where
  runServer :: TCPPort -> PeerRunner m () -> (P2pConduits m -> Host -> TCPPort -> m ()) -> IO ()

instance RunsClient ContextM where
  runClientConnection host' (TCPPort p) sSource handler = do
    let peerAddress = BC.pack $ hostToString host'
    runGeneralTCPClient (clientSettings p peerAddress) $ \app -> do
      let pSource = appSource app
          pSink = appSink app
          conduits = P2pConduits pSource pSink sSource
      -- Logged here, where the address is known, and rethrown so the client
      -- loop's handler can disable the peer: swallowed, every failure was
      -- followed by a fresh dial five seconds later.
      catch
        (handler conduits)
        (\(e :: SomeException) -> do
          $logErrorS "runClientConnection/Exception" . T.pack $ show e
          throwIO e)

instance RunsServer ContextM where
  runServer (TCPPort listenPort') runner handler = do
    let settings = setAfterBind setSocketCloseOnExec $ serverSettings listenPort' "*"
    runGeneralTCPServer settings $ \app -> runner $ \sSource -> do
      let pSource = appSource app
          pSink = appSink app
          conduits = P2pConduits pSource pSink sSource
          ip = fromString . sockAddrToIP $ appSockAddr app
          pn = TCPPort . fromMaybe 30303 . sockAddrToPort $ appSockAddr app
      catch
        (handler conduits ip pn)
        (\(e :: SomeException) -> $logErrorS "runServer/Exception" . T.pack $ show e)

instance Mod.Modifiable WorldBestBlock ContextM where
  get _ =
    RBDB.withRedisBlockDB getWorldBestBlockInfo <&> \case
      Nothing -> WorldBestBlock $ BestBlock (unsafeCreateKeccak256FromWord256 0) (-1)
      Just (BestBlock s n) -> WorldBestBlock $ BestBlock s n
  put _ (WorldBestBlock (BestBlock s n)) =
    RBDB.withRedisBlockDB (updateWorldBestBlockInfo s n) >>= \case
      Left _ -> $logInfoS "ContextM.put WorldBestBlock" $ T.pack "Failed to update WorldBestBlockInfo"
      Right False -> $logInfoS "ContextM.put WorldBestBlock" $ T.pack "NewBlock is not better than existing WorldBestBlock"
      Right True -> return ()

instance Mod.Modifiable BestBlock ContextM where
  get _ =
    RBDB.withRedisBlockDB getBestBlockInfo <&> \case
      Nothing -> BestBlock (unsafeCreateKeccak256FromWord256 0) (-1)
      Just (BestBlock s n) -> BestBlock s n
  put _ (BestBlock s n) =
    RBDB.withRedisBlockDB (putBestBlockInfo s n) >>= \case
      Left err -> error $ "Failed to update best block in Redis: " ++ show err
      Right _ -> return ()

instance Mod.Modifiable BestSequencedBlock ContextM where
  get _ =
    RBDB.withRedisBlockDB getBestSequencedBlockInfo >>= \case
      Nothing -> do
        BestBlock s n <- Mod.get (Mod.Proxy @BestBlock)
        return $ BestSequencedBlock s n [] [] 0
      Just bestSequencedBlock -> return bestSequencedBlock
  put _ bestSequencedBlock =
    RBDB.withRedisBlockDB (putBestSequencedBlockInfo bestSequencedBlock) >>= \case
      Left err -> error $ "Failed to update best sequenced block in Redis: " ++ show err
      Right _ -> return ()

instance (Keccak256 `A.Alters` Proxy (Inbound WireMessage)) ContextM where
  lookup _ k = do
    wms <- readIORef =<< asks configBlockstanbulWireMessages
    let b = S.member k wms
    pure $ if b then Just (Proxy @(Inbound WireMessage)) else Nothing
  insert _ k _ =
    asks configBlockstanbulWireMessages
      >>= flip
        atomicModifyIORef'
        ( \wms ->
            let s = S.size wms
                wms' = if s >= 2000
                         then case toList wms of
                                (x:_) -> S.delete x wms
                                _ -> wms
                         else wms
                !wms'' = wms' S.>| k
             in (wms'', ())
        )
  delete _ k =
    asks configBlockstanbulWireMessages
      >>= flip
        atomicModifyIORef'
        ( \wms ->
            let !wms' = S.delete k wms
             in (wms', ())
        )

instance ((Host, Keccak256) `A.Alters` Proxy (Outbound WireMessage)) ContextM where
  lookup _ k = do
    wms <- _outboundWireMessages <$> Mod.get (Mod.Proxy @Context)
    let b = S.member k wms
    pure $ if b then Just (Proxy @(Outbound WireMessage)) else Nothing
  insert _ k _ = Mod.modifyStatefully_ (Mod.Proxy @Context) $ do
    wms <- use outboundWireMessages
    let s = S.size wms
        wms' = if s >= 2000
                 then case toList wms of
                        (x:_) -> S.delete x wms
                        _ -> wms -- should never happen
                 else wms
        !wms'' = wms' S.>| k
    assign outboundWireMessages wms''
  delete _ k =
    Mod.modifyStatefully_ (Mod.Proxy @Context) $
      outboundWireMessages %= S.delete k

-- | The genesis hash for the handshake, from Redis so a node without the SQL
-- block index (strato-indexer --sql=false, a lite validator) can answer: the
-- canonical entry q:0 when the node has one, else the single hash recorded
-- under block number 0. The second form is what a node syncing from genesis
-- has: the canonical map is only written from the first NewBestBlock, and the
-- genesis bootstrap emits none. The SQL row is the last resort.
instance Mod.Accessible GenesisBlockHash ContextM where
  access _ =
    RBDB.withRedisBlockDB (getCanonical 0) >>= \case
      Just sha -> return $ GenesisBlockHash sha
      Nothing ->
        RBDB.withRedisBlockDB (getHashesByNumber 0) >>= \case
          [sha] -> return $ GenesisBlockHash sha
          _ -> GenesisBlockHash <$> getGenesisBlockHash

instance Mod.Modifiable Context ContextM where
  get _ = readIORef =<< asks configContext
  put _ c = asks configContext >>= flip atomicModifyIORef' (const (c, ()))

instance Mod.Modifiable ActionTimestamp ContextM where
  get _ = actionTimestamp <$> Mod.get (Proxy @Context)
  put _ k = asks configContext >>= flip atomicModifyIORef' (\c -> (c {actionTimestamp = k}, ()))

instance Mod.Accessible ActionTimestamp ContextM where
  access _ = Mod.get (Proxy @ActionTimestamp)

-- Short, because only one connection now acts on a given gap: if that peer
-- fails to deliver, this is how long before another one retries.
resyncDebounce :: NominalDiffTime
resyncDebounce = 5

-- | Node-wide gate for gossip-driven resync requests.
--
-- Deliberately NOT a 'Mod.Modifiable': that only offers get and put, and a
-- get-then-put cannot express this. Every connection is handed the same
-- sequencer event at the same moment, so with a read and a write as separate
-- steps a whole batch of threads reads the stale value and every one of them
-- decides it is the one to fetch. That is the bug this gate exists to prevent,
-- so the decision and the update have to be a single atomic step.
class HasResyncGate m where
  -- | True at most once per (fetch number, 'resyncDebounce' window), across
  -- all connections in the process.
  tryResyncFrom :: Integer -> m Bool

instance HasResyncGate ContextM where
  tryResyncFrom n = do
    ref <- asks configLastResync
    now <- liftIO getCurrentTime
    liftIO . atomicModifyIORef' ref $ \old@(LastResync prev) ->
      let stillFresh = case prev of
            Just (n', t) -> n' == n && (now `diffUTCTime` t) < resyncDebounce
            Nothing -> False
       in if stillFresh
            then (old, False)
            else (LastResync (Just (n, now)), True)

instance Mod.Modifiable [BlockHeader] ContextM where
  get _ = do
    (bHeaders, lastUpdateTS) <- blockHeaders <$> Mod.get (Proxy @Context)
    now <- liftIO getCurrentTime
    let diffTime = now `diffUTCTime` lastUpdateTS
    -- The in-flight body-request set gates ALL body fetching node-wide
    -- (isBodyRequestActive), so a request wedged on an unresponsive peer must
    -- self-heal quickly. This was previously gated on connectionTimeout
    -- (default 3600s), letting one bad peer freeze block downloads for an
    -- hour; 60s is comfortably above any honest body-response round trip.
    if diffTime > 60
      then do
        -- stale cache; override it
        Mod.put (Proxy @[BlockHeader]) []
        pure []
      else pure bHeaders
  put _ k = do
    now <- liftIO getCurrentTime
    asks configContext >>= flip atomicModifyIORef' (\c -> (c {blockHeaders = (k, now)}, ()))

instance Mod.Accessible [BlockHeader] ContextM where
  access _ = Mod.get (Proxy @[BlockHeader])

instance Mod.Modifiable RemainingBlockHeaders ContextM where
  get _ = do
    (remBHeaders, lastUpdateTS) <- remainingBlockHeaders <$> Mod.get (Proxy @Context)
    now <- liftIO getCurrentTime
    let diffTime = now `diffUTCTime` lastUpdateTS
    if diffTime > fromIntegral (Conf.connectionTimeout (p2pConfig ethConf))
      then do
        -- stale cache; override it
        let emptyRBH = RemainingBlockHeaders []
        Mod.put (Proxy @RemainingBlockHeaders) emptyRBH
        pure emptyRBH
      else pure remBHeaders
  put _ k = do
    now <- liftIO getCurrentTime
    asks configContext >>= flip atomicModifyIORef' (\c -> (c {remainingBlockHeaders = (k, now)}, ()))

instance Mod.Accessible RemainingBlockHeaders ContextM where
  access _ = Mod.get (Proxy @RemainingBlockHeaders)

instance Mod.Modifiable PeerAddress ContextM where
  get _ = _blockstanbulPeerAddr <$> Mod.get (Proxy @Context)
  put _ k = asks configContext >>= flip atomicModifyIORef' (\c -> (c {_blockstanbulPeerAddr = k}, ()))

instance Mod.Accessible PeerAddress ContextM where
  access _ = Mod.get (Proxy @PeerAddress)

instance Mod.Accessible RBDB.RedisConnection ContextM where
  access _ = asks configRedisBlockDB

instance AccessibleEnv SQLDB ContextM where
  accessEnv = asks configSQLDB

instance AccessibleEnv PeerStore ContextM where
  accessEnv = asks (PeerStore . configPeerDB)

-- | Every stored record for a host: a peer can be stored under a DNS name
-- (with its resolved address in pPeerIp) as well as under the address itself.
peersByHost :: Host -> ContextM [PPeer]
peersByHost host' = map SQL.entityVal <$> peerQuery (SQL.selectList filters [])
  where
    byHost = [PPeerHost SQL.==. host']
    filters = maybe byHost (\ip -> byHost SQL.||. [PPeerIp SQL.==. Just ip]) (readMaybe $ hostToString host')

instance A.Selectable Host PPeer ContextM where
  select _ = fmap listToMaybe . peersByHost

instance A.Selectable Host [PPeer] ContextM where
  select _ = fmap Just . peersByHost

instance A.Selectable Point PPeer ContextM where
  select _ pk =
    peerQuery actions >>= \case
      [] -> return Nothing
      (x:_) -> return . Just $ SQL.entityVal x
    where
      actions = SQL.selectList [PPeerPubkey SQL.==. Just pk] []

instance Mod.Outputs ContextM [IngestEvent] where
  output ie = do
    envVar <- asks configStreamEnv
    withMVar envVar $ \env -> void . ContextM . runStreamMUsingEnv env $ SK.writeUnseqEvents ie

type MonadP2P m =
  ( MonadIO m,
    MonadLogger m,
    HasResyncGate m,
    MonadResource m,
    MonadUnliftIO m,
    HasVault m,
    HasBlockDB m,
    HasSyncDB m,
    HasPeerDB m,
    m `Mod.Outputs` [IngestEvent],
    All
      '[Mod.Accessible, Mod.Modifiable]
      '[ ActionTimestamp,
         [BlockHeader],
         RemainingBlockHeaders,
         PeerAddress
       ]
      m,
    All
      '[Mod.Accessible]
      '[ GenesisBlockHash
       ]
      m,
    All
      '[Mod.Modifiable]
      '[ BestBlock,
         BestSequencedBlock,
         WorldBestBlock
       ]
      m,
    All2
      '[A.Selectable]
      '[ '(Host, PPeer),
         '(Host, [PPeer])
       ]
      m,
    All2
      '[A.Alters]
      '[ '(Keccak256, Proxy (Inbound WireMessage)),
         '((Host, Keccak256), Proxy (Outbound WireMessage))
       ]
      m
  )

type PeerRunner m a = (ConduitM () P2pEvent m a -> m a) -> IO a

getBlockHeaders :: Mod.Accessible [BlockHeader] m => m [BlockHeader]
getBlockHeaders = Mod.access (Proxy @[BlockHeader])

putBlockHeaders :: Mod.Modifiable [BlockHeader] m => [BlockHeader] -> m ()
putBlockHeaders = Mod.put (Proxy @[BlockHeader])

getRemainingBHeaders :: (Functor m, Mod.Accessible RemainingBlockHeaders m) => m [BlockHeader]
getRemainingBHeaders = unRemainingBlockHeaders <$> Mod.access (Proxy @RemainingBlockHeaders)

putRemainingBHeaders :: Mod.Modifiable RemainingBlockHeaders m => [BlockHeader] -> m ()
putRemainingBHeaders = Mod.put (Proxy @RemainingBlockHeaders) . RemainingBlockHeaders

stampActionTimestamp :: (MonadIO m, Mod.Modifiable ActionTimestamp m) => m ()
stampActionTimestamp = do
  ts <- liftIO getCurrentTime
  Mod.put (Proxy @ActionTimestamp) . ActionTimestamp $ Just ts

getActionTimestamp :: Mod.Accessible ActionTimestamp m => m ActionTimestamp
getActionTimestamp = Mod.access (Proxy @ActionTimestamp)

clearActionTimestamp :: Mod.Modifiable ActionTimestamp m => m ()
clearActionTimestamp = Mod.put (Proxy @ActionTimestamp) emptyActionTimestamp

runContextM :: Config -> ContextM a -> Eff '[VaultData, Logger] ()
runContextM r (ContextM m) = void . withResources $ withReaderEnv r $ runBlockDB (configSQLDB r) m

initConfig :: (MonadLogger m, MonadUnliftIO m) => IORef (S.OSet Keccak256) -> m Config
initConfig wireMessagesRef = do
  dbs <- openDBs

  -- The chiliad sequence numbers sync tasks on Postgres; the SQLite peer
  -- store numbers them in the insert itself (see "Blockchain.SyncDB").
  unless peerStoreIsSqlite $
    runSqlPool (SQL.rawExecute "CREATE SEQUENCE IF NOT EXISTS chiliad MINVALUE 0 START 0;" []) $ peerDB' dbs
  runSqlPool (runPeerStoreMigration SYNCTASK.migrateAll) $ peerDB' dbs

  redisBDBPool <- liftIO (Redis.checkedConnect lookupRedisBlockDBConfig)

  -- Sync tasks are numbered by chiliad: from a Postgres sequence, or on SQLite
  -- from the highest task present. A node restored from a snapshot without
  -- its databases, or with a fresh peer store, starts both at 0 and would set
  -- out to download the whole chain in 1000-block tasks before reaching the
  -- blocks it misses; a node that kept up by gossip for a long time has a
  -- sequence far behind its chain. Start the next task at the chiliad of the
  -- best block Redis holds, and retire unfinished tasks below it: those
  -- blocks are already here. This runs on every role; cores sharing a peer
  -- database may run it at the same time, which is harmless: the UPDATE is
  -- idempotent and GREATEST keeps the sequence monotonic.
  bestBlock <- liftIO $ Redis.runRedis redisBDBPool getBestBlockInfo
  case bestBlock of
    Just (BestBlock _ n) | n >= 1000 -> do
      let chiliad = n `div` 1000
          chiliadV = SQL.PersistInt64 (fromIntegral chiliad)
      $logInfoS "initConfig/syncTasks" . T.pack $
        "Redis best block is #" ++ show n ++ ": sync tasks start at chiliad " ++ show chiliad ++ ", unfinished tasks below it are retired"
      runSqlPool (SQL.rawExecute "UPDATE sync_task SET status = 'Finished' WHERE chiliad < ? AND status != 'Finished'" [chiliadV]) $ peerDB' dbs
      if peerStoreIsSqlite
        then do
          -- The SQLite insert numbers a new task from MAX(chiliad) + 1, so a
          -- finished placeholder one below the target makes the next task the target.
          now <- liftIO getCurrentTime
          let placeholder = SQL.PersistInt64 (fromIntegral (chiliad - 1))
          runSqlPool
            (SQL.rawExecute "INSERT INTO sync_task (chiliad, assignment_time, host, status) SELECT ?, ?, '', 'Finished' WHERE (SELECT COALESCE(MAX(chiliad), -1) FROM sync_task) < ?" [placeholder, SQL.toPersistValue now, placeholder])
            $ peerDB' dbs
        else do
          (_ :: [SQL.Single Int]) <-
            runSqlPool (SQL.rawSql "SELECT setval('chiliad', GREATEST((SELECT COALESCE(MAX(chiliad), -1) + 1 FROM sync_task), ?), false)" [chiliadV]) $ peerDB' dbs
          return ()
    _ -> return ()

  initState <- initContext
  initStateF <- newIORef initState
  let k = Conf.streamingConfig ethConf
  streamEnv <- createStreamEnv "strato-p2p" (Conf.streamingHost k, Conf.streamingPort k)
  streamEnvVar <- newMVar streamEnv
  lastResyncRef <- newIORef $ LastResync Nothing
  return $ Config
    { configSQLDB = sqlDB' dbs
    , configPeerDB = peerDB' dbs
    , configRedisBlockDB = RBDB.RedisConnection redisBDBPool
    , configContext = initStateF
    , configBlockstanbulWireMessages = wireMessagesRef
    , configStreamEnv = streamEnvVar
    , configLastResync = lastResyncRef
    }

initContext :: MonadIO m => m Context
initContext =
  return $
    Context { actionTimestamp = emptyActionTimestamp
            , blockHeaders = ([], jamshidBirth)
            , remainingBlockHeaders = (RemainingBlockHeaders [], jamshidBirth)
            , _blockstanbulPeerAddr = PeerAddress Nothing
            , _outboundWireMessages = S.empty
          }

getPeerByIP ::
  A.Selectable Host PPeer m =>
  Host ->
  m (Maybe PPeer)
getPeerByIP = A.select (Proxy @PPeer)

getPeersByIP ::
  A.Selectable Host [PPeer] m =>
  Host ->
  m [PPeer]
getPeersByIP = fmap (fromMaybe []) . A.select (Proxy @[PPeer])

setPeerAddrIfUnset :: Mod.Modifiable PeerAddress m => Address -> m ()
setPeerAddrIfUnset addr = Mod.modify_ (Proxy @PeerAddress) $ pure . withPeerAddress (<|> Just addr)

shouldSendToPeer :: (Functor m, Mod.Accessible PeerAddress m) => Address -> m Bool
shouldSendToPeer addr = maybe True zeroOrArg . unPeerAddress <$> Mod.access (Proxy @PeerAddress)
  where
    -- 0x0 is for a broadcast sync message.
    zeroOrArg addr' = addr' == 0x0 || addr' == addr

withActivePeer ::
  ( MonadUnliftIO m,
    HasPeerDB m
  ) =>
  PPeer ->
  m a ->
  m a
withActivePeer p = bracket a b . const
  where
    a = setPeerActiveState (pPeerHost p) (pPeerTcpPort p) Active
    b _ = setPeerActiveState (pPeerHost p) (pPeerTcpPort p) Inactive

-- | Hold the stored records of an accepted peer active for the session.
-- 'withActivePeer' finds a peer by host and listening port, which a dialed
-- peer has and an accepted one does not: a connection the server accepted
-- carries the remote's ephemeral source port, which matches no stored row,
-- so until now no inbound peer was ever active in the table. Such a peer is
-- known by its source address (the IP the socket reports) and, once the
-- RLPx handshake is through, by its key. Every record of that key at that
-- address is marked, under the address and under any name stored for it,
-- so the client loop does not dial a peer this node is already in session
-- with. A peer with no record gets one under its address, unbonded and with
-- the default ports, for discovery to bond like any other newcomer; its real
-- ports arrive with its Pong.
withActiveInboundPeer ::
  ( MonadUnliftIO m,
    HasPeerDB m
  ) =>
  Host ->
  Point ->
  m a ->
  m a
withActiveInboundPeer remote pubkey = bracket mark (const unmark) . const
  where
    mark = do
      marked <- setPeerActiveStateByKey remote pubkey Active
      when (marked == 0) $ do
        newcomer <- mkPeer (Just pubkey) remote (readMaybe $ hostToString remote) (UDPPort $ pPeerUdpPort def) (TCPPort $ pPeerTcpPort def)
        insertPeer newcomer {pPeerActiveState = fromEnum Active}
    unmark = void $ setPeerActiveStateByKey remote pubkey Inactive
