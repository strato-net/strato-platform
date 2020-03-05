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
import           Control.Exception
import           Control.Monad                   (void)
import qualified Control.Monad.Change.Alter      as A
import qualified Control.Monad.Change.Modify     as Mod
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Class       (lift)
import           Blockchain.Output
import           Control.Monad.Trans.Resource
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.State
import qualified Data.Map.Strict                 as M
import qualified Data.Text                       as T
import qualified Database.Persist.Postgresql     as SQL

import           Blockchain.Data.BlockDB
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.ChainInfoDB     (putChainInfo)
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
import           Blockchain.Strato.Model.SHA

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

instance Mod.Accessible SQLDB IConfigM where
  access _ = asks contextSQLDB

instance Mod.Modifiable KafkaState IContextM where
  get _   = gets contextKafkaState
  put _ k = get >>= \c -> put c{contextKafkaState = k}

instance Mod.Accessible RBDB.RedisConnection IContextM where
  access _ = contextRedisBlockDB <$> get

data IndexerException = Lookup String String String
                      | Delete String String String
                      deriving (Eq, Show, Exception)

instance (SHA `A.Alters` API OutputTx) IContextM where
  lookup _ _                    = liftIO . throwIO $ Lookup "API" "SHA" "OutputTx"
  delete _ _                    = liftIO . throwIO $ Delete "API" "SHA" "OutputTx"
  insert _ _ (API OutputTx{..}) = void . lift $ insertTX Log otOrigin Nothing [otBaseTx]

instance (Word256 `A.Alters` API ChainInfo) IContextM where
  lookup _ _               = liftIO . throwIO $ Lookup "API" "SHA" "ChainInfo"
  delete _ _               = liftIO . throwIO $ Delete "API" "SHA" "ChainInfo"
  insert _ cId (API cInfo) = void . lift $ putChainInfo cId cInfo

instance (SHA `A.Alters` API OutputBlock) IContextM where
  lookup _ _          = liftIO . throwIO $ Lookup "API" "SHA" "OutputBlock"
  delete _ _          = liftIO . throwIO $ Delete "API" "SHA" "OutputBlock"
  insert _ _ (API ob) = void . lift $ putBlocks [(outputBlockToBlock ob, obTotalDifficulty ob)] False
  insertMany _        = void . lift . flip putBlocks False . map ((outputBlockToBlock &&& obTotalDifficulty) . unAPI) . M.elems

pgPoolSize :: Int
pgPoolSize = 20

targetTopicName :: TopicName
targetTopicName = indexEventsTopicName

runIContextM :: KafkaClientId -> IContextM a -> LoggingT IO a
runIContextM cid f = do
    $logInfoS "runIContextM" . T.pack $ "Creating PG connection pool of size " ++ show pgPoolSize
    sqldb <- runNoLoggingT  $ SQL.createPostgresqlPool connStr pgPoolSize
    redis <- liftIO $ Redis.checkedConnect lookupRedisBlockDBConfig
    ret <- fmap fst
         . runResourceT
         . flip runReaderT (IConfig sqldb)
         . flip runStateT (IContext (mkConfiguredKafkaState cid) (RBDB.RedisConnection redis))
         $ f
    $logInfoS "runIContextM" "runIContextM complete, returning"
    return ret
