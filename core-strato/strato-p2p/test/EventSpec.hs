{-# LANGUAGE FlexibleContexts     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
module EventSpec where

import ClassyPrelude (atomically)
import Conduit
import Control.Monad.Trans.Reader
import Data.Conduit.TMChan
import Database.Persist.Sql
import qualified Data.Text                             as T
import qualified Database.Persist.Sqlite               as Lite
import qualified Database.Redis                        as Redis
import System.IO.Temp                        (emptySystemTempFile)

import Blockchain.Blockstanbul               (blockstanbulSender)
import Blockchain.Context
import Blockchain.Data.ArbitraryInstances()
import qualified Blockchain.Data.Blockchain as DataBlock
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Data.Wire
import Blockchain.Event
import Blockchain.Output
import Blockchain.Sequencer.Event
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
testContext :: (MonadIO m, MonadUnliftIO m)
            => m (TMChan [IngestEvent], Config, Context)
testContext = do
  redisBDBPool <- liftIO . Redis.checkedConnect $ Redis.defaultConnectInfo {
        Redis.connectHost           = "localhost",
        Redis.connectPort           = Redis.PortNumber 2023,
        Redis.connectDatabase       = 0
    }
  -- TODO(tim): cleanup the sqlite_db files, or use :memory: and withSqlitePool
  file <- liftIO $ emptySystemTempFile "p2p.sqlite_db"
  conn <- runNoLoggingT $ Lite.createSqlitePool (T.pack file) 20
  ch <- atomically newTMChan
  return ( ch
         , Config conn
         , Context { actionTimestamp = Nothing
                   , contextRedisBlockDB = redisBDBPool
                   , contextKafkaState = error "no kafka state available"
                   , blockHeaders=[]
                   , unseqSink=atomically . writeTMChan ch
                   , vmEventsSink=const (return ())
                   , vmTrace=[]
                   , connectionTimeout=60
                   , maxReturnedHeaders=1000
                   , _blockstanbulPeerAddr=Nothing
                   })

testPeer :: DataPeer.PPeer
testPeer = DataPeer.buildPeer (Nothing, "0.0.0.0", 1212)

migrateAll :: ReaderT SqlBackend (NoLoggingT (ResourceT IO)) ()
migrateAll = do
  -- TODO(tim): bracket and TRUNCATE the tables in a DBMS agnostic way
  _ <- runMigrationSilent DataBlock.migrateAll
  -- SQLite doesn't have support for dropping columns, and since this is
  -- a brand new file there's no need for the manual migration steps
  _ <- runMigrationSilent DataDefs.migrateAuto
  _ <- runMigrationSilent DataPeer.migrateAll
  return ()

runTestPeer :: (TMChan [IngestEvent] -> ContextM a) -> IO ()
runTestPeer mv = do
  (ch, cfg, ctx) <- testContext
  let pool = configSQLDB cfg
  liftSqlPersistMPool migrateAll pool
  runNoLoggingT (runContextM (cfg, ctx) (mv ch))

spec :: Spec
spec = do
  describe "environment sanity checks" $ do
    it "has a PPeer table" $ do
      runTestPeer . const $ do
        pool <- lift $ asks configSQLDB
        liftSqlPersistMPool (count ([] :: [Filter DataPeer.PPeer])) pool `L.shouldReturn` 0
    it "can pretend to write to kafka" $ do
      quickCheck . once $ \ori txs -> runTestPeer . const $ emitKafkaTransactions ori txs
      quickCheck . once $ \ori blk -> runTestPeer . const $ emitKafkaBlock ori blk
    it "has a redis instance" $ do
      runTestPeer . const $ do
        RBDB.withRedisBlockDB RBDB.getBestBlockInfo `L.shouldReturn` (Nothing :: Maybe RedisBestBlock)

  describe "handleEvents" $ do
    it "should pong a ping" $
      runTestPeer . const $ do
        runConduit $ yield (MsgEvt Ping) .| handleEvents testPeer .| sinkList `L.shouldReturn` [Pong]
    it "should return empty BlockBodies to empty BlockHeaders" $
      runTestPeer . const $ do
        runConduit $ yield (MsgEvt (BlockHeaders [])) .| handleEvents testPeer .| sinkList
          `L.shouldReturn` [GetBlockBodies []]
    it "should forward blockstanbul messages" $ property $ \wm ->
      let addr = blockstanbulSender wm
      in addr /= 0 && addr /= 0xa ==> runTestPeer $ \ch -> do
        -- Without "proof" of which peer this is, assume it could be addr
        shouldSendToPeer addr `L.shouldReturn` True
        shouldSendToPeer 0xa `L.shouldReturn` True
        runConduit $ yield (MsgEvt (Blockstanbul wm))
                           .| handleEvents testPeer
                           .| sinkList
           `L.shouldReturn` []
        atomically (closeTMChan ch >> readTMChan ch) `L.shouldReturn` Just ([IEBlockstanbul wm])
        atomically (readTMChan ch) `L.shouldReturn` Nothing
        -- Now that the peer is known to be addr, we should only send if they are designated
        shouldSendToPeer addr `L.shouldReturn` True
        shouldSendToPeer 0xa `L.shouldReturn` False

    it "should broadcast blockstanbul messages" $ property $ \wm ->
      runTestPeer . const $ do
        runConduit $ yield (NewSeqEvent (OEBlockstanbul wm))
                      .| handleEvents testPeer
                      .| sinkList
            `L.shouldReturn` [Blockstanbul wm]
        -- We should not mistake internal messages as the peers
        shouldSendToPeer 0xa `L.shouldReturn` True
