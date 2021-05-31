{-# LANGUAGE DeriveAnyClass        #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}

module Blockchain.Strato.Indexer.IContext
    ( IContext(..)
    , API(..)
    , P2P(..)
    , TXR(..)
    , IContextM
    , runIContextM
    , targetTopicName
    ) where

import           Control.Arrow                   ((&&&))
import           Control.Monad                   (void)
import           Control.Monad.FT
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Class       (lift)
import           Blockchain.Output
import           Control.Monad.Trans.Resource
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.State       as StateT
import qualified Data.Text                       as T

import           Blockchain.Data.Block           (BestBlock(..), Private(..))
import           Blockchain.Data.BlockDB
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.ChainInfoDB     (putChainInfo)
import           Blockchain.Data.Enode           (ChainMembers(..))
import           Blockchain.Data.Transaction     (insertTX)
import           Blockchain.DBM
import           Blockchain.DB.SQLDB
import           Blockchain.EthConf
import           Blockchain.ExtWord
import qualified Blockchain.Strato.RedisBlockDB  as RBDB
import qualified Database.Redis                  as Redis

import           Network.Kafka
import           Network.Kafka.Protocol

import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Indexer.Kafka
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.Keccak256

newtype IConfig = IConfig { contextSQLDB :: SQLDB }

newtype API a = API { unAPI :: a }
newtype P2P a = P2P { unP2P :: a }
newtype TXR a = TXR { unTXR :: a }

data IContext = IContext
  { contextKafkaState   :: KafkaState
  , contextRedisBlockDB :: RBDB.RedisConnection
  }

type IConfigM = ReaderT IConfig (ResourceT (LoggingT IO))
type IContextM = StateT IContext IConfigM

instance Gettable SQLDB IConfigM where
  get = asks contextSQLDB

instance Gettable KafkaState IContextM where
  get   = StateT.gets contextKafkaState
instance Puttable KafkaState IContextM where
  put k = StateT.modify $ \c -> c{contextKafkaState = k}
instance Modifiable KafkaState IContextM where

instance Gettable RBDB.RedisConnection IContextM where
  get = contextRedisBlockDB <$> StateT.get

instance Insertable (API OutputTx) Keccak256 IContextM where
  insert _ (API OutputTx{..}) = void . lift $ insertTX Log otOrigin Nothing [otBaseTx]

instance Insertable (API ChainInfo) Word256 IContextM where
  insert cId (API cInfo) = void . lift $ putChainInfo (ChainId cId) cInfo

instance Insertable (API OutputBlock) Keccak256 IContextM where
  insert     _ (API ob) = void . lift $ putBlocks [(outputBlockToBlock ob, obTotalDifficulty ob)] False
  insertMany            = void
                        . lift
                        . flip putBlocks False
                        . map ((outputBlockToBlock &&& obTotalDifficulty) . unAPI)
                        . map snd

instance Insertable (P2P (Private (Word256, OutputTx))) Keccak256 IContextM where
  insert   k v = insertMany [(k,v)]
  insertMany   = void
               . RBDB.withRedisBlockDB
               . RBDB.addPrivateTransactions
               . map (fmap $ unPrivate . unP2P)

instance Insertable (P2P OutputBlock) Keccak256 IContextM where
  insert _ = void
           . RBDB.withRedisBlockDB
           . RBDB.putBlock
           . unP2P

instance Puttable (P2P BestBlock) IContextM where
  put (P2P (BestBlock s n d)) = void . RBDB.withRedisBlockDB $ RBDB.putBestBlockInfo s n d

instance Insertable (P2P ChainInfo) Word256 IContextM where
  insert cId = void
             . RBDB.withRedisBlockDB
             . RBDB.putChainInfo cId
             . unP2P

instance Insertable (P2P ChainMembers) Word256 IContextM where
  insert cId = void
             . RBDB.withRedisBlockDB
             . RBDB.putChainMembers cId
             . unChainMembers
             . unP2P

pgPoolSize :: Int
pgPoolSize = 20

targetTopicName :: TopicName
targetTopicName = indexEventsTopicName

runIContextM :: KafkaClientId -> IContextM a -> LoggingT IO a
runIContextM cid f = do
    $logInfoS "runIContextM" . T.pack $ "Creating PG connection pool of size " ++ show pgPoolSize
    sqldb <- runNoLoggingT  $ createPostgresqlPool connStr pgPoolSize
    redis <- liftIO $ Redis.checkedConnect lookupRedisBlockDBConfig
    ret <- fmap fst
         . runResourceT
         . flip runReaderT (IConfig sqldb)
         . flip runStateT (IContext (mkConfiguredKafkaState cid) (RBDB.RedisConnection redis))
         $ f
    $logInfoS "runIContextM" "runIContextM complete, returning"
    return ret
