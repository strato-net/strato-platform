{-# LANGUAGE FlexibleContexts     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
module EventSpec where

import Conduit
import Control.Monad.State.Class
import Control.Monad.Logger
import Control.Monad.Trans.Reader
import Database.Persist.Sql
import qualified Data.Text                             as T
import qualified Database.Persist.Sqlite               as Lite
import qualified Database.Redis                        as Redis
import System.IO.Temp                        (emptySystemTempFile)

import Blockchain.Context
import Blockchain.Data.ArbitraryInstances()
import qualified Blockchain.Data.Blockchain as DataBlock
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Data.Wire
import Blockchain.DBM
import Blockchain.Event
import Blockchain.Output
import Blockchain.Sequencer.Kafka
import qualified Blockchain.Strato.Discovery.Data.Peer as DataPeer
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import Blockchain.Strato.RedisBlockDB.Models

import Test.Hspec
import qualified Test.Hspec.Expectations.Lifted as L
import Test.QuickCheck

-- testContext is useful for testing because it doesn't require
-- Kafka, postgres, or ethconf. It does need redis, but targets
-- a test instance.
testContext :: (MonadIO m, MonadBaseControl IO m)
            => m Context
testContext = do
  redisBDBPool <- liftIO . Redis.checkedConnect $ Redis.defaultConnectInfo {
        Redis.connectHost           = "localhost",
        Redis.connectPort           = Redis.PortNumber 2023,
        Redis.connectDatabase       = 0
    }
  -- TODO(tim): cleanup the sqlite_db files, or use :memory: and withSqlitePool
  file <- liftIO $ emptySystemTempFile "p2p.sqlite_db"
  conn <- runNoLoggingT $ Lite.createSqlitePool (T.pack file) 20
  return Context { actionTimestamp = Nothing
                 , contextRedisBlockDB = redisBDBPool
                 , contextKafkaState = error "no kafka state available"
                 , contextSQLDB = conn
                 , blockHeaders=[]
                 , unseqSink=sinkNull
                 , vmEventsSink=sinkNull
                 , vmTrace=[]
                 }

testPeer :: DataPeer.PPeer
testPeer = DataPeer.buildPeer (Nothing, "0.0.0.0", 1212)

migrateAll :: ReaderT SqlBackend (NoLoggingT (ResourceT IO)) ()
migrateAll = do
  -- TODO(tim): bracket and TRUNCATE the tables in a DBMS agnostic way
  _ <- runMigrationSilent DataBlock.migrateAll
  _ <- runMigrationSilent DataDefs.migrateAll
  _ <- runMigrationSilent DataPeer.migrateAll
  return ()

runTestPeer :: ContextM a -> IO ()
runTestPeer mv = do
  ctx <- testContext
  let pool = contextSQLDB ctx
  liftSqlPersistMPool migrateAll pool
  runLoggingT (runContextM ctx mv) printLogMsg

spec :: Spec
spec = do
  describe "environment sanity checks" $ do
    it "has a PPeer table" $ do
      runTestPeer $ do
        pool <- gets contextSQLDB
        liftSqlPersistMPool (count ([] :: [Filter DataPeer.PPeer])) pool `L.shouldReturn` 0
    it "can pretend to write to kafka" $ do
      quickCheck . once $ \ori txs -> runTestPeer (emitKafkaTransactions ori txs)
      quickCheck . once $ \ori blk -> runTestPeer (emitKafkaBlock ori blk)
    it "has a redis instance" $ do
      runTestPeer $ do
        RBDB.withRedisBlockDB RBDB.getBestBlockInfo `L.shouldReturn` (Nothing :: Maybe RedisBestBlock)

  describe "handleEvents" $ do
    it "should pong a ping" $ do
      runTestPeer $ do
        runConduit $ yield (MsgEvt Ping) .| handleEvents Log testPeer .| sinkList `L.shouldReturn` [Pong]
    it "should return empty BlockBodies to empty BlockHeaders" $ do
      runTestPeer $ do
        runConduit $ yield (MsgEvt (BlockHeaders [])) .| handleEvents Log testPeer .| sinkList
          `L.shouldReturn` [GetBlockBodies []]
