{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE DeriveFunctor         #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE PolyKinds             #-}
{-# LANGUAGE RankNTypes            #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeFamilies          #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# LANGUAGE UndecidableInstances  #-}
{-# OPTIONS -fno-warn-orphans      #-}
{-# OPTIONS -fno-warn-missing-methods #-}
module Blockchain.Context
    ( All
    , All2
    , Stacks(..)
    , MonadP2P
    , TcpPortNumber(..)
    , Inbound(..)
    , Outbound(..)
    , Context(..)
    , Config(..)
    , ContextM
    , ActionTimestamp(..)
    , emptyActionTimestamp
    , RemainingBlockHeaders(..)
    , MaxReturnedHeaders(..)
    , ConnectionTimeout(..)
    , PeerAddress(..)
    , GenesisBlockHash(..)
    , BestBlockNumber(..)
    , OrgNameChains(..)
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
    , getPeerX509
  
    ) where


import           Conduit
import           Control.Applicative
import           Control.Concurrent
import           Control.Lens                          hiding (Context)
import           Control.Arrow                         ((&&&), (***))
import qualified Control.Monad.Change.Alter            as A
import qualified Control.Monad.Change.Modify           as Mod
import           Control.Monad.Reader
import           Crypto.Types.PubKey.ECC
import qualified Data.ByteString                       as B
import           Data.Default
import           Data.Foldable                         (toList)
import qualified Data.Map.Strict                       as M
import           Data.Maybe
import           Data.Proxy
import qualified Data.Set.Ordered                      as S
import qualified Data.Text                             as T
import           Data.Time.Clock
import           GHC.Exts                              (Constraint)

import           BlockApps.Logging
import           BlockApps.X509.Certificate

import           Blockchain.Blockstanbul               (WireMessage)
import           Blockchain.Data.Block
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Enode
import           Blockchain.Data.PubKey
import           Blockchain.DB.DetailsDB
import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           Blockchain.EthConf
import           Blockchain.Options
import           Blockchain.Sequencer.Event
import qualified Blockchain.Sequencer.Kafka            as SK

import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.ContextLite ()
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Stream.VMOutput            ( VMOutput(..)
                                                       , fetchLastVMOutputs
                                                       , getBestKafkaBlockNumber
                                                       , produceVMOutputsM
                                                       )

import qualified Blockchain.Strato.RedisBlockDB        as RBDB
import           Blockchain.Strato.RedisBlockDB.Models (RedisBestBlock(..))
import qualified Database.Persist.Sql                  as SQL
import qualified Database.Redis                        as Redis
import qualified Network.Kafka                         as K
import qualified Blockchain.MilenaTools                as K
import           Network.HTTP.Client                    (newManager, defaultManagerSettings)
import           Servant.Client
import qualified Strato.Strato23.API                   as VC
import qualified Strato.Strato23.Client                as VC

import           UnliftIO

-- TODO: These type families should be exposed by monad-alter, not defined here
--       but merging in the latest monad-alter will take some additional work
type family All' (k :: * -> (* -> *) -> Constraint) (ts :: [*]) (m :: * -> *) :: Constraint where
  All' k (t : '[]) m = k t m
  All' k (t ': ts) m = (k t m, All' k ts m)

type family All (ks :: [* -> (* -> *) -> Constraint]) (ts :: [*]) (m :: * -> *) :: Constraint where
  All (k ': '[]) ts m = All' k ts m
  All (k ': ks) ts m = (All' k ts m, All ks ts m)

type family All2' (k :: * -> * -> (* -> *) -> Constraint) (ts :: [(*,*)]) (m :: * -> *) :: Constraint where
  All2' k ('(t1, t2) : '[]) m = k t1 t2 m
  All2' k ('(t1, t2) ': ts) m = (k t1 t2 m, All2' k ts m)

type family All2 (ks :: [* -> * -> (* -> *) -> Constraint]) (ts :: [(*,*)]) (m :: * -> *) :: Constraint where
  All2 (k ': '[]) ts m = All2' k ts m
  All2 (k ': ks) ts m = (All2' k ts m, All2 ks ts m)

class Stacks a m where
  takeStack :: Proxy a -> Int -> m [a]
  pushStack :: [a] -> m ()

newtype TcpPortNumber = TcpPortNumber { unTcpPortNumber :: Int }

newtype Inbound a = Inbound { unInbound :: a }
newtype Outbound a = Outbound { unOutbound :: a }

data Config = Config
  { configSQLDB              :: SQLDB
  , configRedisBlockDB       :: RBDB.RedisConnection
  , configConnectionTimeout  :: ConnectionTimeout
  , configMaxReturnedHeaders :: MaxReturnedHeaders
  , configVaultClient        :: ClientEnv
  , configContext            :: IORef Context
  , configBlockstanbulWireMessages :: IORef (S.OSet Keccak256)
  }

newtype ActionTimestamp = ActionTimestamp { unActionTimestamp :: Maybe UTCTime }

emptyActionTimestamp :: ActionTimestamp
emptyActionTimestamp = ActionTimestamp Nothing

newtype RemainingBlockHeaders = RemainingBlockHeaders { unRemainingBlockHeaders :: [BlockData] }
newtype MaxReturnedHeaders = MaxReturnedHeaders { unMaxReturnedHeaders :: Int }
newtype ConnectionTimeout = ConnectionTimeout { unConnectionTimeout :: Int }
newtype PeerAddress = PeerAddress { unPeerAddress :: Maybe Address }

withPeerAddress :: (Maybe Address -> Maybe Address) -> PeerAddress -> PeerAddress
withPeerAddress f = PeerAddress . f . unPeerAddress

data Context = Context
  { contextKafkaState     :: K.KafkaState
  , blockHeaders          :: [BlockData]
  , remainingBlockHeaders :: RemainingBlockHeaders
  , actionTimestamp       :: ActionTimestamp
  , _blockstanbulPeerAddr :: PeerAddress
  , _outboundWireMessages :: S.OSet (T.Text, Keccak256)
  }

makeLenses ''Context

newtype GenesisBlockHash = GenesisBlockHash { unGenesisBlockHash :: Keccak256 }
newtype BestBlockNumber = BestBlockNumber { unBestBlockNumber :: Integer }

type ContextM = ReaderT Config (ResourceT (LoggingT IO))

instance MonadIO m => (Keccak256 `A.Alters` BlockData) (ReaderT Config m) where
  lookup _     = RBDB.withRedisBlockDB . RBDB.getHeader
  insert _ k v = void . RBDB.withRedisBlockDB $ RBDB.insertHeader k v
  delete _     = void . RBDB.withRedisBlockDB . RBDB.deleteHeader
  lookupMany _ = fmap (M.fromList . catMaybes . map sequenceA)
               . RBDB.withRedisBlockDB . RBDB.getHeaders
  insertMany _ = void . RBDB.withRedisBlockDB . RBDB.insertHeaders
  deleteMany _ = void . RBDB.withRedisBlockDB . RBDB.deleteHeaders

instance (MonadIO m, MonadLogger m) => Mod.Modifiable WorldBestBlock (ReaderT Config m) where
  get _ = RBDB.withRedisBlockDB RBDB.getWorldBestBlockInfo <&> \case
    Nothing -> WorldBestBlock $ BestBlock (unsafeCreateKeccak256FromWord256 0) (-1) 0
    Just (RedisBestBlock s n d) -> WorldBestBlock $ BestBlock s n d
  put _ (WorldBestBlock (BestBlock s n d)) =
    RBDB.withRedisBlockDB (RBDB.updateWorldBestBlockInfo s n d) >>= \case
      Left  _ -> $logInfoS "ContextM.put WorldBestBlock" $ T.pack "Failed to update WorldBestBlockInfo"
      Right False -> $logInfoS "ContextM.put WorldBestBlock" $ T.pack "NewBlock is not better than existing WorldBestBlock"
      Right True  -> return ()

instance (MonadIO m, MonadLogger m) => Mod.Modifiable BestBlock (ReaderT Config m) where
  get _ = RBDB.withRedisBlockDB RBDB.getBestBlockInfo <&> \case
    Nothing -> BestBlock (unsafeCreateKeccak256FromWord256 0) (-1) 0
    Just (RedisBestBlock s n d) -> BestBlock s n d
  put _ (BestBlock s n d) =
    RBDB.withRedisBlockDB (RBDB.putBestBlockInfo s n d) >>= \case
      Left  _ -> $logInfoS "ContextM.put BestBlock" $ T.pack "Failed to update BestBlock"
      Right _ -> return ()

instance MonadIO m => A.Selectable Integer (Canonical BlockData) (ReaderT Config m) where
  select _ i = fmap (fmap Canonical) . RBDB.withRedisBlockDB $ RBDB.getCanonicalHeader i

instance MonadIO m => A.Selectable IPAddress IPChains (ReaderT Config m) where
  select p ip = A.selectWithDefault p ip <&> toMaybe def
  selectWithDefault _ = fmap IPChains
                      . RBDB.withRedisBlockDB
                      . RBDB.getIPChains

instance MonadIO m => A.Selectable OrgId OrgIdChains (ReaderT Config m) where
  select p ip = A.selectWithDefault p ip <&> toMaybe def
  selectWithDefault _ = fmap OrgIdChains
                      . RBDB.withRedisBlockDB
                      . RBDB.getOrgIdChains
                      . unOrgId

instance MonadIO m => A.Selectable (OrgName, OrgUnit) OrgNameChains (ReaderT Config m) where
  select p ip = A.selectWithDefault p ip <&> toMaybe def
  selectWithDefault _ = fmap OrgNameChains
                      . RBDB.withRedisBlockDB
                      . RBDB.getOrgNameChains
                      . (unOrgName . fst &&& unOrgUnit . snd)
                      
instance MonadIO m => A.Selectable Keccak256 ChainTxsInBlock (ReaderT Config m) where
  select p sha = A.selectWithDefault p sha <&> toMaybe def
  selectWithDefault _ = fmap ChainTxsInBlock
                      . RBDB.withRedisBlockDB
                      . RBDB.getChainTxsInBlock

instance MonadIO m => A.Selectable (Maybe Word256) ParentChainId (ReaderT Config m) where
  selectWithDefault p sha = A.select p sha <&> fromMaybe (ParentChainId Nothing)
  select _ Nothing = pure . Just $ ParentChainId Nothing
  select _ (Just cId) = do
    mCInfo <- RBDB.withRedisBlockDB $ RBDB.getChainInfo cId
    pure $ mCInfo <&> ParentChainId . parentChain . chainInfo

instance MonadIO m => A.Selectable Word256 ChainMembers (ReaderT Config m) where
  select p cid = A.selectWithDefault p cid <&> toMaybe def
  selectWithDefault _ cid = do
    ancestors <- map fromJust . filter isJust <$> getAncestorChains (Just cid)
    allChainMembers <- traverse (RBDB.withRedisBlockDB . RBDB.getChainMembers) ancestors
    case allChainMembers of
      [] -> pure $ ChainMembers M.empty
      _ -> pure . ChainMembers $ foldr1 M.intersection allChainMembers

instance MonadIO m => A.Selectable Word256 ChainInfo (ReaderT Config m) where
  select _ = RBDB.withRedisBlockDB . RBDB.getChainInfo

instance MonadIO m => A.Selectable Keccak256 (Private (Word256, OutputTx)) (ReaderT Config m) where
  select _ = fmap (fmap Private) . RBDB.withRedisBlockDB . RBDB.getPrivateTransactions

instance MonadIO m => A.Selectable Address X509CertInfoState (ReaderT Config m) where
  select _ = RBDB.withRedisBlockDB . RBDB.getCertificate
instance MonadIO m => ((OrgName, OrgUnit) `A.Alters` Word256) (ReaderT Config m) where
  insert _ k v = void . RBDB.withRedisBlockDB $ RBDB.addOrgNameChain ((unOrgName *** unOrgUnit) k) v

instance MonadIO m => (Keccak256 `A.Alters` OutputBlock) (ReaderT Config m) where
  lookup _     = RBDB.withRedisBlockDB . RBDB.getBlock
  insert _ k v = void . RBDB.withRedisBlockDB $ RBDB.insertBlock k v
  delete _     = void . RBDB.withRedisBlockDB . RBDB.deleteBlock
  lookupMany _ = fmap (M.fromList . catMaybes . map sequenceA)
               . RBDB.withRedisBlockDB . RBDB.getBlocks
  insertMany _ = void . RBDB.withRedisBlockDB . RBDB.insertBlocks
  deleteMany _ = void . RBDB.withRedisBlockDB . RBDB.deleteBlocks

instance MonadIO m => (Keccak256 `A.Alters` (Proxy (Inbound WireMessage))) (ReaderT Config m) where
  lookup _  k = do
    wms <- readIORef =<< asks configBlockstanbulWireMessages
    let b = S.member k wms
    pure $ if b then Just (Proxy @(Inbound WireMessage)) else Nothing
  insert _ k _ = asks configBlockstanbulWireMessages >>= flip atomicModifyIORef' (\wms ->
    let s = S.size wms
        wms' = if s >= flags_wireMessageCacheSize then S.delete (head $ toList wms) wms else wms
        wms'' = wms' S.>| k
     in (wms'', ()))
  delete _ k = asks configBlockstanbulWireMessages >>= flip atomicModifyIORef' (\wms ->
    let wms' = S.delete k wms
     in (wms', ()))

instance MonadIO m => ((T.Text, Keccak256) `A.Alters` (Proxy (Outbound WireMessage))) (ReaderT Config m) where
  lookup _  k = do
    wms <- _outboundWireMessages <$> Mod.get (Mod.Proxy @Context)
    let b = S.member k wms
    pure $ if b then Just (Proxy @(Outbound WireMessage)) else Nothing
  insert _ k _ = Mod.modifyStatefully_ (Mod.Proxy @Context) $ do
    wms <- use outboundWireMessages
    let s = S.size wms
        wms' = if s >= flags_wireMessageCacheSize then S.delete (head $ toList wms) wms else wms
        wms'' = wms' S.>| k
    assign outboundWireMessages wms''
  delete _ k = Mod.modifyStatefully_ (Mod.Proxy @Context) $
    outboundWireMessages %= S.delete k

instance ( MonadIO m
         , MonadUnliftIO m
         ) => Mod.Accessible GenesisBlockHash (ReaderT Config m) where
  access _ = GenesisBlockHash <$> getGenesisBlockHash

instance MonadIO m => Mod.Accessible BestBlockNumber (ReaderT Config m) where
  access _ = BestBlockNumber <$> liftIO getBestKafkaBlockNumber

instance MonadIO m => Mod.Modifiable Context (ReaderT Config m) where
  get _   = readIORef =<< asks configContext
  put _ c = asks configContext >>= flip atomicModifyIORef' (const (c, ()))

instance MonadIO m => Mod.Modifiable K.KafkaState (ReaderT Config m) where
  get _   = contextKafkaState <$> Mod.get (Proxy @Context)
  put _ k = asks configContext >>= flip atomicModifyIORef' (\c -> (c{contextKafkaState = k},()))

instance MonadIO m => Mod.Modifiable ActionTimestamp (ReaderT Config m) where
  get _   = actionTimestamp <$> Mod.get (Proxy @Context)
  put _ k = asks configContext >>= flip atomicModifyIORef' (\c -> (c{actionTimestamp = k},()))

instance MonadIO m => Mod.Accessible ActionTimestamp (ReaderT Config m) where
  access _ = Mod.get (Proxy @ActionTimestamp)

instance MonadIO m => Mod.Modifiable [BlockData] (ReaderT Config m) where
  get _   = blockHeaders <$> Mod.get (Proxy @Context)
  put _ k = asks configContext >>= flip atomicModifyIORef' (\c -> (c{blockHeaders = k},()))

instance MonadIO m => Mod.Accessible [BlockData] (ReaderT Config m) where
  access _ = Mod.get (Proxy @[BlockData])

instance MonadIO m => Mod.Modifiable RemainingBlockHeaders (ReaderT Config m) where
  get _   = remainingBlockHeaders <$> Mod.get (Proxy @Context)
  put _ k = asks configContext >>= flip atomicModifyIORef' (\c -> (c{remainingBlockHeaders = k},()))

instance MonadIO m => Mod.Accessible RemainingBlockHeaders (ReaderT Config m) where
  access _ = Mod.get (Proxy @RemainingBlockHeaders)

instance MonadIO m => Mod.Accessible MaxReturnedHeaders (ReaderT Config m) where
  access _ = asks configMaxReturnedHeaders

instance MonadIO m => Mod.Modifiable PeerAddress (ReaderT Config m) where
  get _   = _blockstanbulPeerAddr <$> Mod.get (Proxy @Context)
  put _ k = asks configContext >>= flip atomicModifyIORef' (\c -> (c{_blockstanbulPeerAddr = k},()))

instance MonadIO m => Mod.Accessible PeerAddress (ReaderT Config m) where
  access _ = Mod.get (Proxy @PeerAddress)

instance MonadIO m => Mod.Accessible ConnectionTimeout (ReaderT Config m) where
  access _ = asks configConnectionTimeout

instance MonadIO m => Mod.Accessible RBDB.RedisConnection (ReaderT Config m) where
  access _ = asks configRedisBlockDB

instance MonadIO m => Mod.Accessible SQLDB (ReaderT Config m) where
  access _ = asks configSQLDB

instance MonadIO m => ((IPAsText, TCPPort) `A.Alters` ActivityState) (ReaderT Config m) where
  lookup _ _ = error "lookup ActivityState undefined for ContextM"
  insert _ (IPAsText i, TCPPort p) = void . liftIO . setPeerActiveState i p
  delete _ _ = error "lookup ActivityState undefined for ContextM"

instance (MonadIO m, MonadLogger m) => Stacks Block (ReaderT Config m) where
  takeStack _ n = do
    vmEvents <- liftIO . fetchLastVMOutputs $ fromIntegral n
    pure [b | ChainBlock b <- vmEvents]
  pushStack b = void . produceVMOutputsM $ ChainBlock <$> b

instance MonadUnliftIO m => A.Selectable IPAsText PPeer (ReaderT Config m) where
  select _ (IPAsText ip) = sqlQuery actions >>= \case
        [] -> return Nothing
        lst -> return . Just . SQL.entityVal $ head lst

    where actions = SQL.selectList [ PPeerIp SQL.==. ip ] []

instance (MonadIO m, MonadLogger m) => Mod.Outputs (ReaderT Config m) [IngestEvent] where
  output = void . K.withKafkaRetry1s . SK.writeUnseqEvents

instance (MonadIO m, Monad m, MonadLogger m) => HasVault (ReaderT Config m) where
  sign bs = do
    vc <- asks configVaultClient 
    $logInfoS "HasVault" "Calling vault-wrapper for a signature"
    waitOnVault $ liftIO $ runClientM (VC.postSignature (T.pack "nodekey") (VC.MsgHash bs)) vc
  
  getPub = do
    vc <- asks configVaultClient 
    $logInfoS "HasVault" "Calling vault-wrapper to get the node's public key"
    fmap VC.unPubKey $ waitOnVault $ liftIO $ runClientM (VC.getKey (T.pack "nodekey") Nothing) vc
  
  getShared pub = do
    vc <- asks configVaultClient 
    $logInfoS "HasVault" "Calling vault-wrapper to get a shared key"
    waitOnVault $ liftIO $ runClientM (VC.getSharedKey "nodekey" pub) vc

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

type MonadP2P m = ( MonadIO m
                  , MonadLogger m
                  , MonadResource m
                  , MonadUnliftIO m
                  , Stacks Block m
                  , HasVault m
                  , m `Mod.Outputs` [IngestEvent]
                  , All '[Mod.Accessible, Mod.Modifiable]
                      '[ ActionTimestamp
                       , [BlockData]
                       , RemainingBlockHeaders
                       , PeerAddress
                       ] m
                  , All '[Mod.Accessible]
                      '[ MaxReturnedHeaders
                       , ConnectionTimeout
                       , GenesisBlockHash
                       , BestBlockNumber
                       ] m
                  , All '[Mod.Modifiable]
                      '[ BestBlock
                       , WorldBestBlock
                       ] m
                  , All2 '[A.Selectable]
                      '[ '(Integer, Canonical BlockData)
                       , '(IPAddress, IPChains)
                       , '(OrgId, OrgIdChains)
                       , '((OrgName, OrgUnit), OrgNameChains)
                       , '(Keccak256, ChainTxsInBlock)
                       , '(Word256, ChainMembers)
                       , '(Word256, ChainInfo)
                       , '(Keccak256, Private (Word256, OutputTx))
                       , '(Address, X509CertInfoState)
                       , '((IPAsText, UDPPort, B.ByteString), Point)
                       , '(IPAsText, PPeer)
                       ] m
                  , All2 '[A.Alters]
                      '[ '(Keccak256, BlockData)
                       , '(Keccak256, OutputBlock)
                       , '((OrgName, OrgUnit), Word256)
                       , '(Keccak256, Proxy (Inbound WireMessage))
                       , '((T.Text, Keccak256), Proxy (Outbound WireMessage))
                       , '((IPAsText, TCPPort), ActivityState)
                       ] m
                  )

type PeerRunner n m a = n a -> m a

getBlockHeaders :: Mod.Accessible [BlockData] m => m [BlockData]
getBlockHeaders = Mod.access (Proxy @[BlockData])

putBlockHeaders :: Mod.Modifiable [BlockData] m => [BlockData]-> m ()
putBlockHeaders = Mod.put (Proxy @[BlockData])

getRemainingBHeaders :: (Functor m, Mod.Accessible RemainingBlockHeaders m) => m [BlockData]
getRemainingBHeaders = unRemainingBlockHeaders <$> Mod.access (Proxy @RemainingBlockHeaders)

putRemainingBHeaders :: Mod.Modifiable RemainingBlockHeaders m => [BlockData]-> m ()
putRemainingBHeaders = Mod.put (Proxy @RemainingBlockHeaders) . RemainingBlockHeaders

stampActionTimestamp :: (MonadIO m, Mod.Modifiable ActionTimestamp m) => m ()
stampActionTimestamp = do
  ts <- liftIO getCurrentTime
  Mod.put (Proxy @ActionTimestamp) . ActionTimestamp $ Just ts

getActionTimestamp :: Mod.Accessible ActionTimestamp m => m ActionTimestamp
getActionTimestamp = Mod.access (Proxy @ActionTimestamp)

clearActionTimestamp :: Mod.Modifiable ActionTimestamp m => m ()
clearActionTimestamp = Mod.put (Proxy @ActionTimestamp) emptyActionTimestamp

runContextM :: MonadUnliftIO m
            => r
            -> ReaderT r (ResourceT m) a
            -> m ()
runContextM r = void . runResourceT . flip runReaderT r

initConfig :: ( MonadLogger m
              , MonadUnliftIO m
              )
           => IORef (S.OSet Keccak256) -> Int -> m Config
initConfig wireMessagesRef maxHeaders = do
  dbs <- openDBs
  redisBDBPool <- liftIO (Redis.checkedConnect lookupRedisBlockDBConfig)
  vaultClient <- do
    mgr <- liftIO $ newManager defaultManagerSettings
    url <- liftIO $ parseBaseUrl flags_vaultWrapperUrl
    return $ mkClientEnv mgr url

  initState <- newIORef initContext
  return $ Config
    { configSQLDB = sqlDB' dbs
    , configRedisBlockDB = RBDB.RedisConnection redisBDBPool
    , configConnectionTimeout = ConnectionTimeout flags_connectionTimeout
    , configMaxReturnedHeaders = MaxReturnedHeaders maxHeaders
    , configVaultClient = vaultClient
    , configContext = initState
    , configBlockstanbulWireMessages = wireMessagesRef
    }

initContext :: Context
initContext = Context
  { actionTimestamp = emptyActionTimestamp
  , contextKafkaState = mkConfiguredKafkaState "strato-p2p"
  , blockHeaders = []
  , remainingBlockHeaders = RemainingBlockHeaders []
  , _blockstanbulPeerAddr = PeerAddress Nothing
  , _outboundWireMessages = S.empty
  }


getPeerByIP :: A.Selectable IPAsText PPeer m
            => String
            -> m (Maybe PPeer)
getPeerByIP = A.select (Proxy @PPeer) . IPAsText . T.pack

getPeerX509 :: A.Selectable Address X509CertInfoState m
          => PPeer 
          -> m (Maybe X509CertInfoState)
getPeerX509 peer = case pPeerPubkey peer of
  Nothing -> pure Nothing
  Just pk -> A.select (Proxy @X509CertInfoState) . fromPublicKey . pointToSecPubKey $ pk

setPeerAddrIfUnset :: Mod.Modifiable PeerAddress m => Address -> m ()
setPeerAddrIfUnset addr = Mod.modify_ (Proxy @PeerAddress) $ pure . withPeerAddress (<|> Just addr)

shouldSendToPeer :: (Functor m, Mod.Accessible PeerAddress m) => Address -> m Bool
shouldSendToPeer addr = maybe True zeroOrArg . unPeerAddress <$> Mod.access (Proxy @PeerAddress)
        -- 0x0 is for a broadcast sync message.
  where zeroOrArg addr' = addr' == 0x0 || addr' == addr

withActivePeer :: ( MonadUnliftIO m
                  , ((IPAsText, TCPPort) `A.Alters` ActivityState) m
                  )
               => PPeer -> m a -> m a
withActivePeer p = bracket a b . const
  where a   = A.insert (Proxy @ActivityState) (IPAsText $ pPeerIp p, TCPPort $ pPeerTcpPort p) Active
        b _ = A.insert (Proxy @ActivityState) (IPAsText $ pPeerIp p, TCPPort $ pPeerTcpPort p) Inactive

toMaybe :: Eq a => a -> a -> Maybe a
toMaybe a b = if a == b then Nothing else Just b

