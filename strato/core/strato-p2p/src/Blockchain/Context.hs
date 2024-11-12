{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Context
    ( MonadP2P
    , Inbound(..)
    , Outbound(..)
    , IsValidator(..)
    , Context(..)
    , Config(..)
--    , ContextM
    , P2pConduits(..)
    , peerSource
    , peerSink
    , seqSource
    , RunsClient(..)
    , RunsServer(..)
    , ActionTimestamp(..)
    , emptyActionTimestamp
    , RemainingBlockHeaders(..)
    , MaxReturnedHeaders(..)
    , ConnectionTimeout(..)
    , PeerAddress(..)
    , GenesisBlockHash(..)
    , TrueOrgNameChains(..)
    , FalseOrgNameChains(..)
    , ChainInfo(..)
    , PeerRunner
    , initConfig
    , initContext
    , runContextM
    , blockstanbulPeerAddr
    , getBlockHeaders
    , putBlockHeaders
    , getRemainingBHeaders
    , putRemainingBHeaders
    , stampActionTimestamp
    , getActionTimestamp
    , clearActionTimestamp
    , getPeerByIP
    , setPeerAddrIfUnset
    , shouldSendToPeer
    , withActivePeer
    , withCertifiedPeer
    , getPeerX509
    , getMyX509
    ) where

import           Conduit
import           Control.Applicative
import           Control.Concurrent
import           Control.Exception                     hiding (bracket)
import           Control.Lens                          hiding (Context)
import qualified Control.Monad.Change.Alter            as A
import qualified Control.Monad.Change.Modify           as Mod
import           Control.Monad.Composable.Kafka
import           Control.Monad.Reader
import           Crypto.Types.PubKey.ECC
import qualified Data.ByteString                       as B
import qualified Data.ByteString.Char8                 as BC
import           Data.Conduit.Network
import           Data.Default
import qualified Data.Kind                             as DK
import           Data.Foldable                         (toList)
import qualified Data.Map.Strict                       as M
import           Data.Maybe
import           Data.Proxy
import           Data.Ranged
import qualified Data.Set.Ordered as S
import           Data.String
import qualified Data.Text                             as T
import           Data.Time.Clock
import           GHC.Exts                              (Constraint)

import           BlockApps.Logging
import           BlockApps.X509.Certificate

import           Blockchain.Blockstanbul               (WireMessage)
import           Blockchain.Data.Block
import           Blockchain.Data.BlockHeader
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Enode
import           Blockchain.Data.PubKey
import           Blockchain.DB.DetailsDB
import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           Blockchain.EthConf
import           Blockchain.Options
import           Blockchain.P2PUtil
import           Blockchain.Sequencer.Event
import qualified Blockchain.Sequencer.Kafka            as SK

import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.ContextLite ()
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainMember
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Secp256k1

import qualified Blockchain.Strato.RedisBlockDB        as RBDB
import           Blockchain.Strato.RedisBlockDB.Models (RedisBestBlock(..))
import           Control.Monad                         (void, when)
import           Control.Monad.Composable.Base
import qualified Database.Persist.Sql                  as SQL
import qualified Database.Redis                        as Redis
import           Network.HTTP.Client                    (newManager, defaultManagerSettings)
import           Network.Wai.Handler.Warp.Internal     (setSocketCloseOnExec)
import           Servant.Client
import qualified Strato.Strato23.API                   as VC
import qualified Strato.Strato23.Client                as VC

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

newtype IsValidator = IsValidator {unIsValidator :: Bool}

data Config = Config
  { configSQLDB :: SQLDB,
    configRedisBlockDB :: RBDB.RedisConnection,
    configConnectionTimeout :: ConnectionTimeout,
    configMaxReturnedHeaders :: MaxReturnedHeaders,
    configVaultClient :: ClientEnv,
    configContext :: IORef Context,
    configBlockstanbulWireMessages :: IORef (S.OSet Keccak256),
    configPubKey :: PublicKey
  }

newtype ActionTimestamp = ActionTimestamp {unActionTimestamp :: Maybe UTCTime}

emptyActionTimestamp :: ActionTimestamp
emptyActionTimestamp = ActionTimestamp Nothing

newtype RemainingBlockHeaders = RemainingBlockHeaders {unRemainingBlockHeaders :: [BlockHeader]}

newtype MaxReturnedHeaders = MaxReturnedHeaders {unMaxReturnedHeaders :: Int}

newtype ConnectionTimeout = ConnectionTimeout {unConnectionTimeout :: Int}

newtype PeerAddress = PeerAddress {unPeerAddress :: Maybe ChainMemberParsedSet}

withPeerAddress :: (Maybe ChainMemberParsedSet -> Maybe ChainMemberParsedSet) -> PeerAddress -> PeerAddress
withPeerAddress f = PeerAddress . f . unPeerAddress

data Context = Context
  { contextKafkaState        :: KafkaEnv
  , blockHeaders             :: ([BlockHeader], UTCTime) -- keep track when last updated global headers cache
  , remainingBlockHeaders    :: (RemainingBlockHeaders, UTCTime) -- keep track when last updated global headers cache
  , actionTimestamp          :: ActionTimestamp
  , _blockstanbulPeerAddr    :: PeerAddress
  , _outboundWireMessages :: S.OSet (T.Text, Keccak256)
  }

makeLenses ''Context

newtype GenesisBlockHash = GenesisBlockHash {unGenesisBlockHash :: Keccak256}

type ContextM = ReaderT Config (ResourceT (LoggingT IO))

data P2pConduits m = P2pConduits
  { _peerSource :: ConduitM () B.ByteString m (),
    _peerSink :: ConduitM B.ByteString Void m (),
    _seqSource :: ConduitM () P2pEvent m ()
  }

makeLenses ''P2pConduits

class RunsClient m where
  runClientConnection ::
    IPAsText ->
    TCPPort ->
    ConduitM () P2pEvent m () ->
    (P2pConduits m -> m ()) ->
    m ()

class RunsServer n m where
  runServer :: TCPPort -> PeerRunner n m () -> (P2pConduits n -> IPAsText -> n ()) -> m ()

instance RunsClient ContextM where
  runClientConnection (IPAsText ip) (TCPPort p) sSource handler = do
    let peerAddress = BC.pack $ T.unpack ip
    runGeneralTCPClient (clientSettings p peerAddress) $ \app -> do
      let pSource = appSource app
          pSink = appSink app
          conduits = P2pConduits pSource pSink sSource
      handler conduits



instance RunsServer ContextM (LoggingT IO) where
  runServer (TCPPort listenPort) runner handler = do
    let settings = setAfterBind setSocketCloseOnExec $ serverSettings listenPort "*"
    runGeneralTCPServer settings $ \app -> runner $ \sSource -> do
      let pSource = appSource app
          pSink = appSink app
          conduits = P2pConduits pSource pSink sSource
          ip = IPAsText . T.pack . sockAddrToIP $ appSockAddr app
      handler conduits ip

instance MonadIO m => Mod.Accessible PublicKey (ReaderT Config m) where
  access _ = asks configPubKey

instance MonadIO m => (Keccak256 `A.Alters` BlockHeader) (ReaderT Config m) where
  lookup _ = RBDB.withRedisBlockDB . RBDB.getHeader
  insert _ k v = void . RBDB.withRedisBlockDB $ RBDB.insertHeader k v
  delete _ = void . RBDB.withRedisBlockDB . RBDB.deleteHeader
  lookupMany _ =
    fmap (M.fromList . catMaybes . map sequenceA)
      . RBDB.withRedisBlockDB
      . RBDB.getHeaders
  insertMany _ = void . RBDB.withRedisBlockDB . RBDB.insertHeaders
  deleteMany _ = void . RBDB.withRedisBlockDB . RBDB.deleteHeaders

instance (MonadIO m, MonadLogger m) => Mod.Modifiable WorldBestBlock (ReaderT Config m) where
  get _ =
    RBDB.withRedisBlockDB RBDB.getWorldBestBlockInfo <&> \case
      Nothing -> WorldBestBlock $ BestBlock (unsafeCreateKeccak256FromWord256 0) (-1)
      Just (RedisBestBlock s n) -> WorldBestBlock $ BestBlock s n
  put _ (WorldBestBlock (BestBlock s n)) =
    RBDB.withRedisBlockDB (RBDB.updateWorldBestBlockInfo s n) >>= \case
      Left _ -> $logInfoS "ContextM.put WorldBestBlock" $ T.pack "Failed to update WorldBestBlockInfo"
      Right False -> $logInfoS "ContextM.put WorldBestBlock" $ T.pack "NewBlock is not better than existing WorldBestBlock"
      Right True -> return ()

instance (MonadIO m, MonadLogger m) => Mod.Modifiable BestBlock (ReaderT Config m) where
  get _ =
    RBDB.withRedisBlockDB RBDB.getBestBlockInfo <&> \case
      Nothing -> BestBlock (unsafeCreateKeccak256FromWord256 0) (-1)
      Just (RedisBestBlock s n) -> BestBlock s n
  put _ (BestBlock s n) =
    RBDB.withRedisBlockDB (RBDB.putBestBlockInfo s n) >>= \case
      Left _ -> $logInfoS "ContextM.put BestBlock" $ T.pack "Failed to update BestBlock"
      Right _ -> return ()

instance (MonadIO m, MonadLogger m) => Mod.Modifiable BestSequencedBlock (ReaderT Config m) where
  get _ =
    RBDB.withRedisBlockDB RBDB.getBestSequencedBlockInfo >>= \case
      Nothing -> BestSequencedBlock <$> Mod.get (Mod.Proxy @BestBlock)
      Just (RedisBestBlock s n) -> pure . BestSequencedBlock $ BestBlock s n
  put _ (BestSequencedBlock (BestBlock s n)) =
    RBDB.withRedisBlockDB (RBDB.putBestSequencedBlockInfo s n) >>= \case
      Left _ -> $logInfoS "ContextM.put BestSequencedBlock" $ T.pack "Failed to update BestSequencedBlock"
      Right _ -> return ()

instance MonadIO m => A.Selectable Integer (Canonical BlockHeader) (ReaderT Config m) where
  select _ i = fmap (fmap Canonical) . RBDB.withRedisBlockDB $ RBDB.getCanonicalHeader i

instance MonadIO m => A.Selectable ChainMemberParsedSet TrueOrgNameChains (ReaderT Config m) where
  select p ip = A.selectWithDefault p ip <&> toMaybe def
  selectWithDefault _ =
    fmap TrueOrgNameChains
      . RBDB.withRedisBlockDB
      . RBDB.getTrueOrgNameChainsFromSuperSets

instance MonadIO m => A.Selectable ChainMemberParsedSet FalseOrgNameChains (ReaderT Config m) where
  select p ip = A.selectWithDefault p ip <&> toMaybe def
  selectWithDefault _ =
    fmap FalseOrgNameChains
      . RBDB.withRedisBlockDB
      . RBDB.getFalseOrgNameChainsFromSuperSets

instance MonadIO m => A.Selectable Keccak256 ChainTxsInBlock (ReaderT Config m) where
  select p sha = A.selectWithDefault p sha <&> toMaybe def
  selectWithDefault _ =
    fmap ChainTxsInBlock
      . RBDB.withRedisBlockDB
      . RBDB.getChainTxsInBlock

instance MonadIO m => A.Selectable Word256 ParentChainIds (ReaderT Config m) where
  selectWithDefault p sha = A.select p sha <&> fromMaybe (ParentChainIds M.empty)
  select _ cId = do
    mCInfo <- RBDB.withRedisBlockDB $ RBDB.getChainInfo cId
    pure $ mCInfo <&> ParentChainIds . parentChains . chainInfo

instance (MonadIO m, MonadLogger m) => A.Selectable Word256 ChainMemberRSet (ReaderT Config m) where
  select p cid = Just <$> A.selectWithDefault p cid
  selectWithDefault _ cid = do
    ancestors <- toList <$> getAncestorChains cid
    allRSets <- traverse (RBDB.withRedisBlockDB . RBDB.getChainMembers) ancestors
    case allRSets of
      [] -> pure $ ChainMemberRSet rSetEmpty
      rsets -> do
        let ancestorChains@(ChainMemberRSet rset) = foldr1 (\(ChainMemberRSet a) (ChainMemberRSet b) -> ChainMemberRSet $ rSetIntersection a b) rsets
        when (rSetIsEmpty rset) $
          $logWarnS "Selectable ChainMemberRSet" "a member is added, and it is NOT a member of any ancestor chains"
        pure ancestorChains

instance MonadIO m => A.Selectable Word256 ChainInfo (ReaderT Config m) where
  select _ = RBDB.withRedisBlockDB . RBDB.getChainInfo

instance MonadIO m => A.Selectable Keccak256 (Private (Word256, OutputTx)) (ReaderT Config m) where
  select _ = fmap (fmap Private) . RBDB.withRedisBlockDB . RBDB.getPrivateTransactions

instance MonadIO m => A.Selectable Address X509CertInfoState (ReaderT Config m) where
  select _ = RBDB.withRedisBlockDB . RBDB.getCertificate

instance MonadIO m => (Keccak256 `A.Alters` OutputBlock) (ReaderT Config m) where
  lookup _ = RBDB.withRedisBlockDB . RBDB.getBlock
  insert _ k v = void . RBDB.withRedisBlockDB $ RBDB.insertBlock k v
  delete _ = void . RBDB.withRedisBlockDB . RBDB.deleteBlock
  lookupMany _ =
    fmap (M.fromList . catMaybes . map sequenceA)
      . RBDB.withRedisBlockDB
      . RBDB.getBlocks
  insertMany _ = void . RBDB.withRedisBlockDB . RBDB.insertBlocks
  deleteMany _ = void . RBDB.withRedisBlockDB . RBDB.deleteBlocks

instance MonadIO m => (ChainMemberParsedSet `A.Selectable` X509CertInfoState) (ReaderT Config m) where
  select _ = RBDB.withRedisBlockDB . RBDB.getCertFromParsedSet

instance MonadIO m => A.Selectable ChainMemberParsedSet [ChainMemberParsedSet] (ReaderT Config m) where
  select _ = RBDB.withRedisBlockDB . RBDB.getChainMembersFromSet

instance MonadIO m => A.Selectable ChainMemberParsedSet IsValidator (ReaderT Config m) where
  select _ = fmap (Just . IsValidator) . RBDB.withRedisBlockDB . RBDB.isValidator

instance MonadIO m => (Keccak256 `A.Alters` (Proxy (Inbound WireMessage))) (ReaderT Config m) where
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
                wms' = if s >= 2000 then S.delete (head $ toList wms) wms else wms
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

instance MonadIO m => ((T.Text, Keccak256) `A.Alters` (Proxy (Outbound WireMessage))) (ReaderT Config m) where
  lookup _ k = do
    wms <- _outboundWireMessages <$> Mod.get (Mod.Proxy @Context)
    let b = S.member k wms
    pure $ if b then Just (Proxy @(Outbound WireMessage)) else Nothing
  insert _ k _ = Mod.modifyStatefully_ (Mod.Proxy @Context) $ do
    wms <- use outboundWireMessages
    let s = S.size wms
        wms' = if s >= 2000 then S.delete (head $ toList wms) wms else wms
        !wms'' = wms' S.>| k
    assign outboundWireMessages wms''
  delete _ k =
    Mod.modifyStatefully_ (Mod.Proxy @Context) $
      outboundWireMessages %= S.delete k

instance
  ( MonadUnliftIO m
  ) =>
  Mod.Accessible GenesisBlockHash (ReaderT Config m)
  where
  access _ = GenesisBlockHash <$> getGenesisBlockHash

instance MonadIO m => Mod.Modifiable Context (ReaderT Config m) where
  get _ = readIORef =<< asks configContext
  put _ c = asks configContext >>= flip atomicModifyIORef' (const (c, ()))

instance MonadIO m => Mod.Modifiable KafkaEnv (ReaderT Config m) where
  get _ = contextKafkaState <$> Mod.get (Proxy @Context)
  put _ k = asks configContext >>= flip atomicModifyIORef' (\c -> (c {contextKafkaState = k}, ()))

instance MonadIO m => Mod.Modifiable ActionTimestamp (ReaderT Config m) where
  get _ = actionTimestamp <$> Mod.get (Proxy @Context)
  put _ k = asks configContext >>= flip atomicModifyIORef' (\c -> (c {actionTimestamp = k}, ()))

instance MonadIO m => Mod.Accessible ActionTimestamp (ReaderT Config m) where
  access _ = Mod.get (Proxy @ActionTimestamp)

instance MonadIO m => Mod.Modifiable [BlockHeader] (ReaderT Config m) where
  get _ = do
    (bHeaders, lastUpdateTS) <- blockHeaders <$> Mod.get (Proxy @Context)
    now <- liftIO getCurrentTime
    let diffTime = now `diffUTCTime` lastUpdateTS
    maxTime <- fromIntegral . unConnectionTimeout <$> Mod.access (Proxy @ConnectionTimeout)
    if diffTime > maxTime
      then do
        -- stale cache; override it
        Mod.put (Proxy @[BlockHeader]) []
        pure []
      else pure bHeaders
  put _ k = do
    now <- liftIO getCurrentTime
    asks configContext >>= flip atomicModifyIORef' (\c -> (c {blockHeaders = (k, now)}, ()))

instance MonadIO m => Mod.Accessible [BlockHeader] (ReaderT Config m) where
  access _ = Mod.get (Proxy @[BlockHeader])

instance MonadIO m => Mod.Modifiable RemainingBlockHeaders (ReaderT Config m) where
  get _ = do
    (remBHeaders, lastUpdateTS) <- remainingBlockHeaders <$> Mod.get (Proxy @Context)
    now <- liftIO getCurrentTime
    let diffTime = now `diffUTCTime` lastUpdateTS
    maxTime <- fromIntegral . unConnectionTimeout <$> Mod.access (Proxy @ConnectionTimeout)
    if diffTime > maxTime
      then do
        -- stale cache; override it
        let emptyRBH = RemainingBlockHeaders []
        Mod.put (Proxy @RemainingBlockHeaders) emptyRBH
        pure emptyRBH
      else pure remBHeaders
  put _ k = do
    now <- liftIO getCurrentTime
    asks configContext >>= flip atomicModifyIORef' (\c -> (c {remainingBlockHeaders = (k, now)}, ()))

instance MonadIO m => Mod.Accessible RemainingBlockHeaders (ReaderT Config m) where
  access _ = Mod.get (Proxy @RemainingBlockHeaders)

instance MonadIO m => Mod.Accessible MaxReturnedHeaders (ReaderT Config m) where
  access _ = asks configMaxReturnedHeaders

instance MonadIO m => Mod.Modifiable PeerAddress (ReaderT Config m) where
  get _ = _blockstanbulPeerAddr <$> Mod.get (Proxy @Context)
  put _ k = asks configContext >>= flip atomicModifyIORef' (\c -> (c {_blockstanbulPeerAddr = k}, ()))

instance MonadIO m => Mod.Accessible PeerAddress (ReaderT Config m) where
  access _ = Mod.get (Proxy @PeerAddress)

instance MonadIO m => Mod.Accessible ConnectionTimeout (ReaderT Config m) where
  access _ = asks configConnectionTimeout

instance MonadIO m => Mod.Accessible RBDB.RedisConnection (ReaderT Config m) where
  access _ = asks configRedisBlockDB

instance MonadIO m => Mod.Accessible SQLDB (ReaderT Config m) where
  access _ = asks configSQLDB

instance {-# OVERLAPPING #-} MonadIO m => AccessibleEnv SQLDB (ReaderT Config m) where
  accessEnv = asks configSQLDB

instance MonadUnliftIO m => A.Selectable IPAsText PPeer (ReaderT Config m) where
  select _ (IPAsText ip) =
    sqlQuery actions >>= \case
      [] -> return Nothing
      lst -> return . Just . SQL.entityVal $ head lst
    where
      actions = SQL.selectList [PPeerIp SQL.==. ip] []

instance MonadUnliftIO m => A.Selectable Point PPeer (ReaderT Config m) where
  select _ pk =
    sqlQuery actions >>= \case
      [] -> return Nothing
      lst -> return . Just . SQL.entityVal $ head lst
    where
      actions = SQL.selectList [PPeerPubkey SQL.==. (Just pk)] []

instance MonadIO m => Mod.Outputs (ReaderT Config m) [IngestEvent] where
  output = void . runKafkaMConfigured "strato-p2p" . SK.writeUnseqEvents


instance (MonadIO m, MonadLogger m) => HasVault (ReaderT Config m) where
  sign bs = do
    vc <- asks configVaultClient
    $logInfoS "HasVault" "Calling vault-wrapper for a signature"
    waitOnVault $ liftIO $ runClientM (VC.postSignature Nothing (VC.MsgHash bs)) vc

  getPub = asks configPubKey

  getShared pub = do
    vc <- asks configVaultClient
    $logInfoS "HasVault" "Calling vault-wrapper to get a shared key"
    waitOnVault $ liftIO $ runClientM (VC.getSharedKey Nothing pub) vc

instance MonadIO m => A.Selectable (IPAsText, UDPPort, B.ByteString) Point (ReaderT Config m) where
  select p = liftIO . A.select p

waitOnVault :: (MonadLogger m, MonadIO m, Show a) => m (Either a b) -> m b
waitOnVault action = do
  res <- action
  case res of
    Left err -> do
      $logErrorS "HasVault" . T.pack $ "Got an error from vault-wrapper: " ++ show err
      liftIO $ threadDelay 2000000
      waitOnVault action
    Right val -> return val

type MonadP2P m =
  ( MonadIO m,
    MonadLogger m,
    MonadResource m,
    MonadUnliftIO m,
    HasVault m,
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
      '[ MaxReturnedHeaders,
         ConnectionTimeout,
         GenesisBlockHash,
         AvailablePeers,
         BondedPeers,
         PublicKey
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
      '[ '(Integer, Canonical BlockHeader),
         '(ChainMemberParsedSet, TrueOrgNameChains),
         '(ChainMemberParsedSet, FalseOrgNameChains),
         '(Keccak256, ChainTxsInBlock),
         '(Word256, ChainMemberRSet),
         '(Word256, ChainInfo),
         '(Keccak256, Private (Word256, OutputTx)),
         '(Address, X509CertInfoState),
         '((IPAsText, UDPPort, B.ByteString), Point),
         '(IPAsText, PPeer),
         '(Point, PPeer),
         '(ChainMemberParsedSet, X509CertInfoState),
         '(ChainMemberParsedSet, [ChainMemberParsedSet]),
         '(ChainMemberParsedSet, IsValidator)
       ]
      m,
    All2
      '[A.Replaceable]
      '[ '(PPeer, TcpEnableTime),
         '(PPeer, UdpEnableTime),
         '(PPeer, PeerDisable),
         '(PPeer, T.Text),
         '((IPAsText, Point), PeerBondingState)
       ]
      m,
    All2
      '[A.Alters]
      '[ '(Keccak256, BlockHeader),
         '(Keccak256, OutputBlock),
         '(Keccak256, Proxy (Inbound WireMessage)),
         '((T.Text, Keccak256), Proxy (Outbound WireMessage)),
         '((IPAsText, TCPPort), ActivityState)
       ]
      m
  )

type PeerRunner n m a = (ConduitM () P2pEvent n a -> n a) -> m a

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

runContextM ::
  MonadUnliftIO m =>
  r ->
  ReaderT r (ResourceT m) a ->
  m ()
runContextM r = void . runResourceT . flip runReaderT r

initConfig :: (MonadLogger m, MonadUnliftIO m) => IORef (S.OSet Keccak256) -> Int -> m Config
initConfig wireMessagesRef maxHeaders = do
  dbs <- openDBs
  redisBDBPool <- liftIO (Redis.checkedConnect lookupRedisBlockDBConfig)
  vaultClient <- do
    mgr <- liftIO $ newManager defaultManagerSettings
    url <- liftIO $ parseBaseUrl flags_vaultWrapperUrl
    return $ mkClientEnv mgr url
  nodePubKey <- do
    $logInfoS "HasVault" "Calling vault-wrapper to get the node's public key"
    fmap VC.unPubKey $ waitOnVault $ liftIO $ runClientM (VC.getKey Nothing Nothing) vaultClient

  initState <- initContext
  initStateF <- newIORef initState
  return $ Config
    { configSQLDB = sqlDB' dbs
    , configRedisBlockDB = RBDB.RedisConnection redisBDBPool
    , configConnectionTimeout = ConnectionTimeout flags_connectionTimeout
    , configMaxReturnedHeaders = MaxReturnedHeaders maxHeaders
    , configVaultClient = vaultClient
    , configContext = initStateF
    , configBlockstanbulWireMessages = wireMessagesRef
    , configPubKey = nodePubKey
    }

initContext :: MonadIO m => m Context
initContext = do
  let k = kafkaConfig ethConf
      address = (fromString $ kafkaHost k, fromIntegral $ kafkaPort k)
  kafkaEnv <- createKafkaEnv "strato-p2p" address
  return $
    Context { actionTimestamp = emptyActionTimestamp
            , contextKafkaState = kafkaEnv
            , blockHeaders = ([], jamshidBirth)
            , remainingBlockHeaders = (RemainingBlockHeaders [], jamshidBirth)
            , _blockstanbulPeerAddr = PeerAddress Nothing
            , _outboundWireMessages = S.empty
          }

getPeerByIP ::
  A.Selectable IPAsText PPeer m =>
  IPAsText ->
  m (Maybe PPeer)
getPeerByIP = A.select (Proxy @PPeer)

getPeerX509 ::
  A.Selectable Address X509CertInfoState m =>
  PPeer ->
  m (Maybe X509CertInfoState)
getPeerX509 peer = case pPeerPubkey peer of
  Nothing -> pure Nothing
  Just pk -> A.select (Proxy @X509CertInfoState) . fromPublicKey . pointToSecPubKey $ pk

getMyX509 ::
  (A.Selectable Address X509CertInfoState m, Mod.Accessible PublicKey m) =>
  m (Maybe X509CertInfoState)
getMyX509 = Mod.access (Mod.Proxy @PublicKey) >>= A.select (Proxy @X509CertInfoState) . fromPublicKey

setPeerAddrIfUnset :: Mod.Modifiable PeerAddress m => ChainMemberParsedSet -> m ()
setPeerAddrIfUnset addr = Mod.modify_ (Proxy @PeerAddress) $ pure . withPeerAddress (<|> Just addr)

shouldSendToPeer :: (Functor m, Mod.Accessible PeerAddress m) => ChainMemberParsedSet -> m Bool
shouldSendToPeer addr = maybe True zeroOrArg . unPeerAddress <$> Mod.access (Proxy @PeerAddress)
  where
    -- 0x0 is for a broadcast sync message.
    zeroOrArg addr' = addr' == emptyChainMember || addr' == addr

withActivePeer ::
  ( MonadUnliftIO m,
    ((IPAsText, TCPPort) `A.Alters` ActivityState) m
  ) =>
  PPeer ->
  m a ->
  m a
withActivePeer p = bracket a b . const
  where
    a = A.insert (Proxy @ActivityState) (IPAsText $ pPeerIp p, TCPPort $ pPeerTcpPort p) Active
    b _ = A.insert (Proxy @ActivityState) (IPAsText $ pPeerIp p, TCPPort $ pPeerTcpPort p) Inactive

withCertifiedPeer :: PPeer -> m (Maybe SomeException) -> m (Maybe SomeException)
withCertifiedPeer = flip const

toMaybe :: Eq a => a -> a -> Maybe a
toMaybe a b = if a == b then Nothing else Just b
