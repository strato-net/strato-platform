{-# LANGUAGE FlexibleContexts     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
module EventSpec where

import ClassyPrelude (atomically, void, getCurrentTime)
import Conduit
import Control.Monad.Logger
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

import Test.Hspec (Spec, describe, it)
import Test.Hspec.Expectations.Lifted
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
  now <- liftIO getCurrentTime
  return ( ch
         , Config conn 0.001 -- 1ms timeout
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
                   , syncTimestamp = now
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
  runLoggingT (runContextM (cfg, ctx) (mv ch)) printLogMsg

sendEvent :: Event -> ContextM [Message]
sendEvent evt = runConduit $ yield evt .| handleEvents testPeer .| sinkList

spec :: Spec
spec = do
  describe "environment sanity checks" $ do
    it "has a PPeer table" . runTestPeer . const $ do
        pool <- lift $ asks configSQLDB
        liftSqlPersistMPool (count ([] :: [Filter DataPeer.PPeer])) pool `shouldReturn` 0
    it "can pretend to write to kafka" $ do
      quickCheck . once $ \ori txs -> runTestPeer . const $ emitKafkaTransactions ori txs
      quickCheck . once $ \ori blk -> runTestPeer . const $ emitKafkaBlock ori blk
    it "has a redis instance" . runTestPeer . const $
        RBDB.withRedisBlockDB RBDB.getBestBlockInfo `shouldReturn` (Nothing :: Maybe RedisBestBlock)

  describe "handleEvents" $ do
    it "should pong a ping" . runTestPeer . const $
        sendEvent (MsgEvt Ping) `shouldReturn` [Pong]
    it "should return empty BlockBodies to empty BlockHeaders" . runTestPeer . const $
        sendEvent (MsgEvt (BlockHeaders [])) `shouldReturn` [GetBlockBodies []]
    it "should forward blockstanbul messages" $ property $ \wm ->
      runTestPeer $ \ch -> do
        let addr = blockstanbulSender wm
        -- Without "proof" of which peer this is, assume it could be addr
        shouldSendToPeer addr `shouldReturn` True
        shouldSendToPeer 0xa `shouldReturn` True
        sendEvent (MsgEvt (Blockstanbul wm)) `shouldReturn` []
        atomically (closeTMChan ch >> readTMChan ch) `shouldReturn` Just [IEBlockstanbul wm]
        atomically (readTMChan ch) `shouldReturn` Nothing
        -- Now that the peer is known to be addr, we should only send if they are designated
        shouldSendToPeer addr `shouldReturn` True
        shouldSendToPeer 0xa `shouldReturn` False

    it "should broadcast blockstanbul messages" $ property $ \wm ->
      runTestPeer . const $ do
        sendEvent (NewSeqEvent (OEBlockstanbul wm)) `shouldReturn` [Blockstanbul wm]
        -- We should not mistake internal messages as the peers
        shouldSendToPeer 0xa `shouldReturn` True

    it "should request messages from peers when behind" . runTestPeer . const $
      sendEvent (NewSeqEvent (OEAskForBlocks 200 450 0xdeadbeef))
        `shouldReturn` [GetBlockHeaders (BlockNumber 200) 1000 0 Forward]

    it "should limit the number of blocks requested for" . runTestPeer . const $
      void $ sendEvent (NewSeqEvent (OEAskForBlocks 0 20000 0xdeadbeef))
        `shouldReturn` [GetBlockHeaders (BlockNumber 0) 1000 0 Forward]
