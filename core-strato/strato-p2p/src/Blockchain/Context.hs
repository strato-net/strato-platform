{-# LANGUAGE FlexibleContexts     #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE LambdaCase           #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE ScopedTypeVariables  #-}
{-# LANGUAGE TypeOperators        #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE Rank2Types           #-}
{-# LANGUAGE TemplateHaskell      #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# OPTIONS -fno-warn-orphans #-}
module Blockchain.Context
    ( Context(..)
    , Config(..)
    , ContextM
    , GenesisBlockHash(..)
    , BestBlockNumber(..)
    , initContext
    , runContextM
    , getDebugMsg
    , addDebugMsg
    , getBlockHeaders
    , putBlockHeaders
    , getRemainingBHeaders
    , putRemainingBHeaders
    , clearDebugMsg
    , stampActionTimestamp
    , getActionTimestamp
    , clearActionTimestamp
    , getPeerByIP
    , setPeerAddrIfUnset
    , shouldSendToPeer
    ) where


import           Conduit
import           Control.Applicative
import           Control.Lens                          hiding (Context)
import qualified Control.Monad.Change.Alter            as A
import qualified Control.Monad.Change.Modify           as Mod
import           Blockchain.Output
import           Control.Monad.Reader
import           Control.Monad.State
import           Data.Default
import qualified Data.Map.Strict                       as M
import           Data.Maybe
import qualified Data.Set                              as S
import qualified Data.Text                             as T
import           Data.Time.Clock

import           Blockchain.Data.Address
import           Blockchain.Data.Block
import           Blockchain.Data.BlockHeader
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Enode
import           Blockchain.Data.TransactionDef
import           Blockchain.DB.DetailsDB
import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           Blockchain.EthConf
import           Blockchain.ExtWord
import           Blockchain.Options
import           Blockchain.Sequencer.Event            (IngestEvent (..))
import           Blockchain.Sequencer.Kafka            (writeUnseqEvents, HasUnseqSink(..))

import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Model.SHA
import           Blockchain.Stream.VMEvent             ( HasVMEventsSink(..)
                                                       , VMEvent
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

newtype Config = Config { configSQLDB :: SQLDB }

data Context = Context
  { contextRedisBlockDB   :: RBDB.RedisConnection
  , contextKafkaState     :: K.KafkaState
  , vmTrace               :: [String]
  , unseqSink             :: forall m . (MonadIO m, Mod.Modifiable K.KafkaState m) => [IngestEvent] -> m ()
  , vmEventsSink          :: forall m . (MonadIO m, Mod.Modifiable K.KafkaState m) => [VMEvent] -> m ()
  , blockHeaders          :: [BlockHeader]
  , remainingBlockHeaders :: [BlockHeader]
  , actionTimestamp       :: Maybe UTCTime
  , connectionTimeout     :: Int
  , maxReturnedHeaders    :: Int
  , _blockstanbulPeerAddr :: Maybe Address
  }

makeLenses ''Context

newtype GenesisBlockHash = GenesisBlockHash { unGenesisBlockHash :: SHA }
newtype BestBlockNumber = BestBlockNumber { unBestBlockNumber :: Integer }

type ContextM = StateT Context (ReaderT Config (ResourceT (LoggingT IO)))

instance MonadIO m => (SHA `A.Alters` BlockData) (StateT Context m) where
  lookup _     = RBDB.withRedisBlockDB . RBDB.getHeader
  insert _ k v = void . RBDB.withRedisBlockDB $ RBDB.insertHeader k v
  delete _     = void . RBDB.withRedisBlockDB . RBDB.deleteHeader
  lookupMany _ = fmap (M.fromList . catMaybes . map sequenceA)
               . RBDB.withRedisBlockDB . RBDB.getHeaders
  insertMany _ = void . RBDB.withRedisBlockDB . RBDB.insertHeaders
  deleteMany _ = void . RBDB.withRedisBlockDB . RBDB.deleteHeaders

instance (MonadIO m, MonadLogger m) => Mod.Modifiable WorldBestBlock (StateT Context m) where
  get _ = RBDB.withRedisBlockDB RBDB.getWorldBestBlockInfo <&> \case
    Nothing -> WorldBestBlock $ BestBlock (SHA 0) (-1) 0
    Just (RedisBestBlock s n d) -> WorldBestBlock $ BestBlock s n d
  put _ (WorldBestBlock (BestBlock s n d)) =
    RBDB.withRedisBlockDB (RBDB.updateWorldBestBlockInfo s n d) >>= \case
      Left  _ -> $logInfoS "ContextM.put WorldBestBlock" $ T.pack "Failed to update WorldBestBlockInfo"
      Right False -> $logInfoS "ContextM.put WorldBestBlock" $ T.pack "NewBlock is not better than existing WorldBestBlock"
      Right True  -> return ()

instance (MonadIO m, MonadLogger m) => Mod.Modifiable BestBlock (StateT Context m) where
  get _ = RBDB.withRedisBlockDB RBDB.getBestBlockInfo <&> \case
    Nothing -> BestBlock (SHA 0) (-1) 0
    Just (RedisBestBlock s n d) -> BestBlock s n d
  put _ (BestBlock s n d) =
    RBDB.withRedisBlockDB (RBDB.putBestBlockInfo s n d) >>= \case
      Left  _ -> $logInfoS "ContextM.put BestBlock" $ T.pack "Failed to update BestBlock"
      Right _ -> return ()

instance MonadIO m => A.Selectable Integer (Canonical BlockHeader) (StateT Context m) where
  select _ i = fmap (fmap Canonical) . RBDB.withRedisBlockDB $ RBDB.getCanonicalHeader i

instance MonadIO m => (SHA `A.Alters` BlockHeader) (StateT Context m) where
  lookup _     = RBDB.withRedisBlockDB . RBDB.getHeader
  insert _ k v = void . RBDB.withRedisBlockDB $ RBDB.insertHeader k v
  delete _     = void . RBDB.withRedisBlockDB . RBDB.deleteHeader
  lookupMany _ = fmap (M.fromList . catMaybes . map sequenceA)
               . RBDB.withRedisBlockDB . RBDB.getHeaders
  insertMany _ = void . RBDB.withRedisBlockDB . RBDB.insertHeaders
  deleteMany _ = void . RBDB.withRedisBlockDB . RBDB.deleteHeaders

instance MonadIO m => A.Selectable IPAddress IPChains (StateT Context m) where
  select p ip = A.selectWithDefault p ip <&> toMaybe def
  selectWithDefault _ = fmap (IPChains . S.fromList)
                      . RBDB.withRedisBlockDB
                      . RBDB.getIPChains

instance MonadIO m => A.Selectable SHA ChainTxsInBlock (StateT Context m) where
  select p sha = A.selectWithDefault p sha <&> toMaybe def
  selectWithDefault _ = fmap ChainTxsInBlock
                      . RBDB.withRedisBlockDB
                      . RBDB.getChainTxsInBlock

instance MonadIO m => A.Selectable Word256 ChainMembers (StateT Context m) where
  select p cid = A.selectWithDefault p cid <&> toMaybe def
  selectWithDefault _ = fmap ChainMembers
                      . RBDB.withRedisBlockDB
                      . RBDB.getChainMembers

instance MonadIO m => A.Selectable Word256 ChainInfo (StateT Context m) where
  select _ = RBDB.withRedisBlockDB . RBDB.getChainInfo

instance MonadIO m => A.Selectable SHA (Private Transaction) (StateT Context m) where
  select _ = fmap (fmap Private) . RBDB.withRedisBlockDB . RBDB.getPrivateTransactions

instance MonadIO m => (SHA `A.Alters` Block) (StateT Context m) where
  lookup _     = RBDB.withRedisBlockDB . RBDB.getBlock
  insert _ k v = void . RBDB.withRedisBlockDB $ RBDB.insertBlock k v
  delete _     = void . RBDB.withRedisBlockDB . RBDB.deleteBlock
  lookupMany _ = fmap (M.fromList . catMaybes . map sequenceA)
               . RBDB.withRedisBlockDB . RBDB.getBlocks
  insertMany _ = void . RBDB.withRedisBlockDB . RBDB.insertBlocks
  deleteMany _ = void . RBDB.withRedisBlockDB . RBDB.deleteBlocks

instance ( MonadIO m
         , MonadUnliftIO m
         , MonadReader Config m
         ) => Mod.Accessible GenesisBlockHash (StateT Context m) where
  access _ = GenesisBlockHash <$> runWithSQL getGenesisBlockHash

instance MonadIO m => Mod.Accessible BestBlockNumber (StateT Context m) where
  access _ = BestBlockNumber <$> liftIO getBestKafkaBlockNumber

instance Monad m => Mod.Modifiable K.KafkaState (StateT Context m) where
  get _   = gets contextKafkaState
  put _ k = modify $ \c -> c{contextKafkaState = k}

instance MonadIO m => Mod.Accessible RBDB.RedisConnection (StateT Context m) where
  access _ = gets contextRedisBlockDB

instance (MonadUnliftIO m, MonadReader Config m, MonadIO m) => HasSQLDB m where
  getSQLDB = asks configSQLDB

instance HasSQLDB m => WrapsSQLDB (StateT Context) m where
  runWithSQL = lift

instance (MonadState Context m, MonadIO m, Mod.Modifiable K.KafkaState m) => HasUnseqSink m where
  getUnseqSink = gets unseqSink

instance (MonadState Context m, MonadIO m, Mod.Modifiable K.KafkaState m) => HasVMEventsSink m where
  getVMEventsSink = gets vmEventsSink

getDebugMsg :: MonadState Context m => m String
getDebugMsg = concat . reverse . vmTrace <$> get

getBlockHeaders :: MonadState Context m => m [BlockHeader]
getBlockHeaders = blockHeaders <$> get

putBlockHeaders :: MonadState Context m => [BlockHeader]->m ()
putBlockHeaders headers = do
    cxt <- get
    put cxt{blockHeaders=headers}

getRemainingBHeaders :: MonadState Context m => m [BlockHeader]
getRemainingBHeaders = remainingBlockHeaders <$> get

putRemainingBHeaders :: MonadState Context m => [BlockHeader]->m ()
putRemainingBHeaders headers = do
    cxt <- get
    put cxt{remainingBlockHeaders=headers}

addDebugMsg :: MonadState Context m => String->m ()
addDebugMsg msg = do
    cxt <- get
    put cxt{vmTrace=msg:vmTrace cxt}

clearDebugMsg :: MonadState Context m => m ()
clearDebugMsg = do
    cxt <- get
    put cxt{vmTrace=[]}

stampActionTimestamp :: (MonadIO m, MonadState Context m) => m ()
stampActionTimestamp = do
    cxt <- get
    ts <- liftIO getCurrentTime
    put cxt{actionTimestamp=Just ts}

getActionTimestamp :: MonadState Context m => m (Maybe UTCTime)
getActionTimestamp = actionTimestamp <$> get

clearActionTimestamp :: MonadState Context m => m ()
clearActionTimestamp = do
    cxt <- get
    put cxt{actionTimestamp=Nothing}

runContextM :: MonadUnliftIO m
            => (r, s)
            -> StateT s (ReaderT r (ResourceT m)) a
            -> m ()
runContextM (r, s) = void . runResourceT . flip runReaderT r . flip runStateT s

initContext :: ( MonadLogger m
               , MonadUnliftIO m
               )
            => Int -> m (Config, Context)
initContext maxHeaders = do
  dbs <- openDBs
  redisBDBPool <- liftIO (Redis.checkedConnect lookupRedisBlockDBConfig)
  return (Config (sqlDB' dbs),
         Context { actionTimestamp = Nothing
                 , contextRedisBlockDB = RBDB.RedisConnection redisBDBPool
                 , contextKafkaState = mkConfiguredKafkaState "strato-p2p"
                 , blockHeaders=[]
                 , remainingBlockHeaders=[]
                 , unseqSink=void . K.withKafkaViolently . writeUnseqEvents
                 , vmEventsSink=void . produceVMEventsM
                 , vmTrace=[]
                 , connectionTimeout=flags_connectionTimeout
                 , maxReturnedHeaders = maxHeaders
                 , _blockstanbulPeerAddr = Nothing
                 })


getPeerByIP :: WrapsSQLDB t m
            => String
            -> (t m) (Maybe (SQL.Entity PPeer))
getPeerByIP ip = runWithSQL $ do
    db <- getSQLDB
    SQL.runSqlPool actions db >>= \case
        [] -> return Nothing
        lst -> return . Just $ head lst

    where actions = SQL.selectList [ PPeerIp SQL.==. T.pack ip ] []

setPeerAddrIfUnset :: MonadState Context m => Address -> m ()
setPeerAddrIfUnset addr = blockstanbulPeerAddr %= (<|> Just addr)

shouldSendToPeer :: MonadState Context m => Address -> m Bool
shouldSendToPeer addr = maybe True zeroOrArg <$> use blockstanbulPeerAddr
        -- TODO(tim): 0x0 may come from a Legacy kafka message, remove
        -- in a future release
  where zeroOrArg addr' = addr' == 0x0 || addr' == addr
