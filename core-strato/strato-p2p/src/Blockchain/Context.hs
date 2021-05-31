{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE DeriveFunctor         #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE PolyKinds             #-}
{-# LANGUAGE Rank2Types            #-}
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
    ) where


import           Conduit
import           Control.Applicative
import           Control.Concurrent
import           Control.Lens                          hiding (Context)
import           Control.Monad.FT
import           Blockchain.Output
import           Control.Monad.Reader
import           Data.Default
import           Data.Foldable                         (toList)
import qualified Data.Map.Strict                       as M
import           Data.Maybe
import           Data.Proxy
import qualified Data.Set.Ordered                      as S
import qualified Data.Text                             as T
import           Data.Time.Clock
import           GHC.Exts                              (Constraint)

import           Blockchain.Blockstanbul               (WireMessage)
import           Blockchain.Data.Address
import           Blockchain.Data.Block
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Enode
import           Blockchain.DB.DetailsDB
import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           Blockchain.EthConf
import           Blockchain.ExtWord
import           Blockchain.Options
import           Blockchain.Sequencer.Event
import qualified Blockchain.Sequencer.Kafka            as SK

import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Stream.VMEvent             ( HasVMEventsSink(..)
                                                       , VMEvent(..)
                                                       , fetchLastVMEvents
                                                       , getBestKafkaBlockNumber
                                                       , produceVMEventsM
                                                       )

import qualified Blockchain.Strato.RedisBlockDB        as RBDB
import           Blockchain.Strato.RedisBlockDB.Models (RedisBestBlock(..))
import qualified Database.Persist.Sql                  as SQL
import qualified Database.Redis                        as Redis
import qualified Network.Kafka                         as K
import qualified Blockchain.MilenaTools                as K
import           Blockchain.Util                       (toMaybe)
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

type family FlipAll2' (k :: * -> * -> (* -> *) -> Constraint) (ts :: [(*,*)]) (m :: * -> *) :: Constraint where
  FlipAll2' k ('(t1, t2) : '[]) m = k t2 t1 m
  FlipAll2' k ('(t1, t2) ': ts) m = (k t2 t1 m, FlipAll2' k ts m)

type family FlipAll2 (ks :: [* -> * -> (* -> *) -> Constraint]) (ts :: [(*,*)]) (m :: * -> *) :: Constraint where
  FlipAll2 (k ': '[]) ts m = FlipAll2' k ts m
  FlipAll2 (k ': ks) ts m = (FlipAll2' k ts m, FlipAll2 ks ts m)

class Stacks a m where
  takeStack :: Int -> m [a]
  pushStack :: [a] -> m ()

newtype TcpPortNumber = TcpPortNumber { unTcpPortNumber :: Int }

newtype Inbound a = Inbound { unInbound :: a }
newtype Outbound a = Outbound { unOutbound :: a }

data Config = Config
  { configSQLDB              :: SQLDB
  , configRedisBlockDB       :: RBDB.RedisConnection
  , configUnseqSink          :: forall m . (MonadIO m, MonadLogger m, Modifiable K.KafkaState m) => [IngestEvent] -> m ()
  , configVmEventsSink       :: forall m . (MonadIO m, MonadLogger m, Modifiable K.KafkaState m) => [VMEvent] -> m ()
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
  , vmTrace               :: [String]
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

instance MonadIO m => Selectable BlockData Keccak256 (ReaderT Config m) where
  select     = RBDB.withRedisBlockDB . RBDB.getHeader
  selectMany = RBDB.withRedisBlockDB . RBDB.getHeaders
instance MonadIO m => Insertable BlockData Keccak256 (ReaderT Config m) where
  insert k v = void . RBDB.withRedisBlockDB $ RBDB.insertHeader k v
  insertMany = void . RBDB.withRedisBlockDB . RBDB.insertHeaders . M.fromList
instance MonadIO m => Deletable  BlockData Keccak256 (ReaderT Config m) where
  delete     = void . RBDB.withRedisBlockDB . RBDB.deleteHeader
  deleteMany = void . RBDB.withRedisBlockDB . RBDB.deleteHeaders
instance MonadIO m => Alterable  BlockData Keccak256 (ReaderT Config m) where

instance MonadIO m => Gettable WorldBestBlock (ReaderT Config m) where
  get = RBDB.withRedisBlockDB RBDB.getWorldBestBlockInfo <&> \case
    Nothing -> WorldBestBlock $ BestBlock (unsafeCreateKeccak256FromWord256 0) (-1) 0
    Just (RedisBestBlock s n d) -> WorldBestBlock $ BestBlock s n d
instance (MonadIO m, MonadLogger m) => Puttable WorldBestBlock (ReaderT Config m) where
  put (WorldBestBlock (BestBlock s n d)) =
    RBDB.withRedisBlockDB (RBDB.updateWorldBestBlockInfo s n d) >>= \case
      Left  _ -> $logInfoS "ContextM.put WorldBestBlock" $ T.pack "Failed to update WorldBestBlockInfo"
      Right False -> $logInfoS "ContextM.put WorldBestBlock" $ T.pack "NewBlock is not better than existing WorldBestBlock"
      Right True  -> return ()
instance (MonadIO m, MonadLogger m) => Modifiable WorldBestBlock (ReaderT Config m) where

instance MonadIO m => Gettable BestBlock (ReaderT Config m) where
  get = RBDB.withRedisBlockDB RBDB.getBestBlockInfo <&> \case
    Nothing -> BestBlock (unsafeCreateKeccak256FromWord256 0) (-1) 0
    Just (RedisBestBlock s n d) -> BestBlock s n d
instance (MonadIO m, MonadLogger m) => Puttable BestBlock (ReaderT Config m) where
  put (BestBlock s n d) =
    RBDB.withRedisBlockDB (RBDB.putBestBlockInfo s n d) >>= \case
      Left  _ -> $logInfoS "ContextM.put BestBlock" $ T.pack "Failed to update BestBlock"
      Right _ -> return ()
instance (MonadIO m, MonadLogger m) => Modifiable BestBlock (ReaderT Config m) where

instance MonadIO m => Selectable (Canonical BlockData) Integer (ReaderT Config m) where
  select i = fmap (fmap Canonical) . RBDB.withRedisBlockDB $ RBDB.getCanonicalHeader i

instance MonadIO m => Selectable IPChains IPAddress (ReaderT Config m) where
  select = fmap (toMaybe def . IPChains)
         . RBDB.withRedisBlockDB
         . RBDB.getIPChains

instance MonadIO m => Selectable OrgIdChains OrgId (ReaderT Config m) where
  select = fmap (toMaybe def . OrgIdChains)
         . RBDB.withRedisBlockDB
         . RBDB.getOrgIdChains
         . unOrgId

instance MonadIO m => Selectable ChainTxsInBlock Keccak256 (ReaderT Config m) where
  select = fmap (toMaybe def . ChainTxsInBlock)
         . RBDB.withRedisBlockDB
         . RBDB.getChainTxsInBlock

instance MonadIO m => Selectable ParentChainId (Maybe Word256) (ReaderT Config m) where
  select Nothing = pure . Just $ ParentChainId Nothing
  select (Just cId) = do
    mCInfo <- RBDB.withRedisBlockDB $ RBDB.getChainInfo cId
    pure $ mCInfo <&> ParentChainId . parentChain . chainInfo

instance MonadIO m => Selectable ChainMembers Word256 (ReaderT Config m) where
  select cid = do
    ancestors <- map fromJust . filter isJust <$> getAncestorChains (Just cid)
    allChainMembers <- traverse (RBDB.withRedisBlockDB . RBDB.getChainMembers) ancestors
    case allChainMembers of
      [] -> pure . Just $ ChainMembers M.empty
      _ -> pure . Just . ChainMembers $ foldr1 M.intersection allChainMembers

instance MonadIO m => Selectable ChainInfo Word256 (ReaderT Config m) where
  select = RBDB.withRedisBlockDB . RBDB.getChainInfo

instance MonadIO m => Selectable (Private (Word256, OutputTx)) Keccak256 (ReaderT Config m) where
  select = fmap (fmap Private) . RBDB.withRedisBlockDB . RBDB.getPrivateTransactions

instance MonadIO m => Selectable OutputBlock Keccak256 (ReaderT Config m) where
  select     = RBDB.withRedisBlockDB . RBDB.getBlock
  selectMany = RBDB.withRedisBlockDB . RBDB.getBlocks
instance MonadIO m => Insertable OutputBlock Keccak256 (ReaderT Config m) where
  insert k v = void . RBDB.withRedisBlockDB $ RBDB.insertBlock k v
  insertMany = void . RBDB.withRedisBlockDB . RBDB.insertBlocks . M.fromList
instance MonadIO m => Deletable  OutputBlock Keccak256 (ReaderT Config m) where
  delete     = void . RBDB.withRedisBlockDB . RBDB.deleteBlock
  deleteMany = void . RBDB.withRedisBlockDB . RBDB.deleteBlocks
instance MonadIO m => Alterable  OutputBlock Keccak256 (ReaderT Config m) where

instance MonadIO m => Selectable (Proxy (Inbound WireMessage)) Keccak256 (ReaderT Config m) where
  select k = do
    wms <- readIORef =<< asks configBlockstanbulWireMessages
    let b = S.member k wms
    pure $ if b then Just (Proxy @(Inbound WireMessage)) else Nothing
instance MonadIO m => Insertable (Proxy (Inbound WireMessage)) Keccak256 (ReaderT Config m) where
  insert k _ = asks configBlockstanbulWireMessages >>= flip atomicModifyIORef' (\wms ->
    let s = S.size wms
        wms' = if s >= flags_wireMessageCacheSize then S.delete (head $ toList wms) wms else wms
        wms'' = wms' S.>| k
     in (wms'', ()))
instance MonadIO m => Deletable  (Proxy (Inbound WireMessage)) Keccak256 (ReaderT Config m) where
  delete k = asks configBlockstanbulWireMessages >>= flip atomicModifyIORef' (\wms ->
    let wms' = S.delete k wms
     in (wms', ()))
instance MonadIO m => Alterable  (Proxy (Inbound WireMessage)) Keccak256 (ReaderT Config m) where

instance MonadIO m => Selectable (Proxy (Outbound WireMessage)) (T.Text, Keccak256) (ReaderT Config m) where
  select k = do
    wms <- _outboundWireMessages <$> get @Context
    let b = S.member k wms
    pure $ if b then Just (Proxy @(Outbound WireMessage)) else Nothing
instance MonadIO m => Insertable (Proxy (Outbound WireMessage)) (T.Text, Keccak256) (ReaderT Config m) where
  insert k _ = modifyStatefully_ @Context $ do
    wms <- use outboundWireMessages
    let s = S.size wms
        wms' = if s >= flags_wireMessageCacheSize then S.delete (head $ toList wms) wms else wms
        wms'' = wms' S.>| k
    assign outboundWireMessages wms''
instance MonadIO m => Deletable  (Proxy (Outbound WireMessage)) (T.Text, Keccak256) (ReaderT Config m) where
  delete k = modifyStatefully_ @Context $
    outboundWireMessages %= S.delete k
instance MonadIO m => Alterable  (Proxy (Outbound WireMessage)) (T.Text, Keccak256) (ReaderT Config m) where

instance ( MonadIO m
         , MonadUnliftIO m
         ) => Gettable GenesisBlockHash (ReaderT Config m) where
  get = GenesisBlockHash <$> getGenesisBlockHash

instance MonadIO m => Gettable BestBlockNumber (ReaderT Config m) where
  get = BestBlockNumber <$> liftIO getBestKafkaBlockNumber

-- TODO: Add an instance of modifyReturningPure that utilizes the atomicModifyIORef'
instance MonadIO m => Gettable Context (ReaderT Config m) where
  get   = readIORef =<< asks configContext
instance MonadIO m => Puttable Context (ReaderT Config m) where
  put c = asks configContext >>= flip atomicModifyIORef' (const (c, ()))
instance MonadIO m => Modifiable Context (ReaderT Config m) where

instance MonadIO m => Gettable K.KafkaState (ReaderT Config m) where
  get   = contextKafkaState <$> get @Context
instance MonadIO m => Puttable K.KafkaState (ReaderT Config m) where
  put k = asks configContext >>= flip atomicModifyIORef' (\c -> (c{contextKafkaState = k},()))
instance MonadIO m => Modifiable K.KafkaState (ReaderT Config m) where

instance MonadIO m => Gettable ActionTimestamp (ReaderT Config m) where
  get   = actionTimestamp <$> get @Context
instance MonadIO m => Puttable ActionTimestamp (ReaderT Config m) where
  put k = asks configContext >>= flip atomicModifyIORef' (\c -> (c{actionTimestamp = k},()))
instance MonadIO m => Modifiable ActionTimestamp (ReaderT Config m) where

instance MonadIO m => Gettable [BlockData] (ReaderT Config m) where
  get   = blockHeaders <$> get @Context
instance MonadIO m => Puttable [BlockData] (ReaderT Config m) where
  put k = asks configContext >>= flip atomicModifyIORef' (\c -> (c{blockHeaders = k},()))
instance MonadIO m => Modifiable [BlockData] (ReaderT Config m) where

instance MonadIO m => Gettable RemainingBlockHeaders (ReaderT Config m) where
  get   = remainingBlockHeaders <$> get @Context
instance MonadIO m => Puttable RemainingBlockHeaders (ReaderT Config m) where
  put k = asks configContext >>= flip atomicModifyIORef' (\c -> (c{remainingBlockHeaders = k},()))
instance MonadIO m => Modifiable RemainingBlockHeaders (ReaderT Config m) where

instance MonadIO m => Gettable MaxReturnedHeaders (ReaderT Config m) where
  get = asks configMaxReturnedHeaders

instance MonadIO m => Gettable PeerAddress (ReaderT Config m) where
  get   = _blockstanbulPeerAddr <$> get @Context
instance MonadIO m => Puttable PeerAddress (ReaderT Config m) where
  put k = asks configContext >>= flip atomicModifyIORef' (\c -> (c{_blockstanbulPeerAddr = k},()))
instance MonadIO m => Modifiable PeerAddress (ReaderT Config m) where

instance MonadIO m => Gettable ConnectionTimeout (ReaderT Config m) where
  get = asks configConnectionTimeout

instance MonadIO m => Gettable RBDB.RedisConnection (ReaderT Config m) where
  get = asks configRedisBlockDB

instance MonadIO m => Gettable SQLDB (ReaderT Config m) where
  get = asks configSQLDB

instance MonadIO m => Insertable ActivityState (T.Text, Int) (ReaderT Config m) where
  insert k = void . liftIO . setPeerActiveState (fst k) (snd k)

instance (MonadIO m, MonadLogger m) => Gettable (SK.UnseqSink (ReaderT Config m)) (ReaderT Config m) where
  get = asks configUnseqSink

instance (MonadIO m, MonadLogger m) => HasVMEventsSink (ReaderT Config m) where
  getVMEventsSink = asks configVmEventsSink

instance (MonadIO m, MonadLogger m) => Stacks Block (ReaderT Config m) where
  takeStack n = do
    vmEvents <- liftIO . fetchLastVMEvents $ fromIntegral n
    pure [b | ChainBlock b <- vmEvents]
  pushStack b = getVMEventsSink >>= \sink -> sink (ChainBlock <$> b)

instance MonadUnliftIO m => Selectable PPeer String (ReaderT Config m) where
  select ip = sqlQuery actions >>= \case
        [] -> return Nothing
        lst -> return . Just . SQL.entityVal $ head lst

    where actions = SQL.selectList [ PPeerIp SQL.==. T.pack ip ] []


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
                  , All '[Gettable]
                      '[ MaxReturnedHeaders
                       , ConnectionTimeout
                       , GenesisBlockHash
                       , BestBlockNumber
                       ] m
                  , All '[Modifiable]
                      '[ ActionTimestamp
                       , [BlockData]
                       , RemainingBlockHeaders
                       , PeerAddress
                       , BestBlock
                       , WorldBestBlock
                       ] m
                  , FlipAll2 '[Selectable]
                      '[ '(Integer, Canonical BlockData)
                       , '(IPAddress, IPChains)
                       , '(OrgId, OrgIdChains)
                       , '(Keccak256, ChainTxsInBlock)
                       , '(Word256, ChainMembers)
                       , '(Word256, ChainInfo)
                       , '(Keccak256, Private (Word256, OutputTx))
                       ] m
                  , FlipAll2 '[Alterable]
                      '[ '(Keccak256, BlockData)
                       , '(Keccak256, OutputBlock)
                       , '(Keccak256, Proxy (Inbound WireMessage))
                       , '((T.Text, Keccak256), Proxy (Outbound WireMessage))
                       ] m
                  )

getBlockHeaders :: Gettable [BlockData] m => m [BlockData]
getBlockHeaders = get

putBlockHeaders :: Puttable [BlockData] m => [BlockData]-> m ()
putBlockHeaders = put

getRemainingBHeaders :: Gettable RemainingBlockHeaders m => m [BlockData]
getRemainingBHeaders = unRemainingBlockHeaders <$> get

putRemainingBHeaders :: Puttable RemainingBlockHeaders m => [BlockData]-> m ()
putRemainingBHeaders = put . RemainingBlockHeaders

stampActionTimestamp :: (MonadIO m, Puttable ActionTimestamp m) => m ()
stampActionTimestamp = do
  ts <- liftIO getCurrentTime
  put . ActionTimestamp $ Just ts

getActionTimestamp :: Gettable ActionTimestamp m => m ActionTimestamp
getActionTimestamp = get

clearActionTimestamp :: Puttable ActionTimestamp m => m ()
clearActionTimestamp = put emptyActionTimestamp

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
    return $ ClientEnv mgr url Nothing

  initState <- newIORef initContext
  return $ Config
    { configSQLDB = sqlDB' dbs
    , configRedisBlockDB = RBDB.RedisConnection redisBDBPool
    , configUnseqSink = void . K.withKafkaRetry1s . SK.writeUnseqEvents
    , configVmEventsSink = void . produceVMEventsM
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
  , vmTrace=[]
  , _blockstanbulPeerAddr = PeerAddress Nothing
  , _outboundWireMessages = S.empty
  }


getPeerByIP :: (String `Selects` PPeer) m
            => String
            -> m (Maybe PPeer)
getPeerByIP = select

setPeerAddrIfUnset :: Modifiable PeerAddress m => Address -> m ()
setPeerAddrIfUnset addr = modifyPure_ $ withPeerAddress (<|> Just addr)

shouldSendToPeer :: Gettable PeerAddress m => Address -> m Bool
shouldSendToPeer addr = maybe True zeroOrArg . unPeerAddress <$> get
        -- 0x0 is for a broadcast sync message.
  where zeroOrArg addr' = addr' == 0x0 || addr' == addr

withActivePeer :: ( MonadUnliftIO m
                  , ((T.Text, Int) `Inserts` ActivityState) m
                  )
               => PPeer -> m a -> m a
withActivePeer p = bracket a b . const
  where a   = insert (pPeerIp p, pPeerTcpPort p) Active
        b _ = insert (pPeerIp p, pPeerTcpPort p) Inactive
