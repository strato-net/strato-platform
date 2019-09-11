{-# LANGUAGE FlexibleContexts     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
module EventSpec where

import ClassyPrelude (atomically)
import Conduit
import Control.Monad.Trans.Reader
import Data.Conduit.TMChan
import Database.Persist.Sql
import Database.Persist.Postgresql
import qualified Data.Map                              as M
import qualified Database.Redis                        as Redis
import Text.Printf

import Blockchain.Blockstanbul               (blockstanbulSender)
import Blockchain.Context
import Blockchain.Data.ArbitraryInstances()
import qualified Blockchain.Data.Blockchain as DataBlock
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Data.Control
import Blockchain.Data.Enode
import Blockchain.Data.Wire
import Blockchain.Event
import Blockchain.Options (AuthorizationMode(..))
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
            => ConnectionPool -> m (TMChan [IngestEvent], Config, Context)
testContext pool = do
  redisBDBPool <- liftIO . Redis.checkedConnect $ Redis.defaultConnectInfo {
        Redis.connectHost           = "localhost",
        Redis.connectPort           = Redis.PortNumber 2023,
        Redis.connectDatabase       = 0
    }
  ch <- atomically newTMChan
  return ( ch
         , Config pool
         , Context { actionTimestamp = Nothing
                   , contextRedisBlockDB = RBDB.RedisConnection redisBDBPool
                   , contextKafkaState = error "no kafka state available"
                   , blockHeaders=[]
                   , remainingBlockHeaders=[]
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
  runNoLoggingT $ withPostgresqlPool "host=localhost port=2345 user=postgres" 4 $ \pool -> do
    (ch, cfg, ctx) <- testContext pool
    liftSqlPersistMPool migrateAll pool
    runContextM (cfg, ctx) (mv ch)

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
        runConduit $ yield (MsgEvt Ping) .| handleEvents testPeer .| sinkList `L.shouldReturn` [Right Pong]
    it "should return empty BlockBodies to empty BlockHeaders" $
      runTestPeer . const $ do
        runConduit $ yield (MsgEvt (BlockHeaders [])) .| handleEvents testPeer .| sinkList
          `L.shouldReturn` [Right $ GetBlockBodies []]
    it "should forward blockstanbul messages" $ property $ withMaxSuccess 10 $ \wm ->
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

    it "should broadcast blockstanbul messages" $ property $ withMaxSuccess 10 $ \wm ->
      runTestPeer . const $ do
        runConduit $ yield (NewSeqEvent (P2pBlockstanbul wm))
                      .| handleEvents testPeer
                      .| sinkList
            `L.shouldReturn` [Right $ Blockstanbul wm]
        -- We should not mistake internal messages as the peers
        shouldSendToPeer 0xa `L.shouldReturn` True

    it "should forward a timer to a TXQueue timeout" $ do
      runTestPeer . const $ do
        runConduit $ yield TimerEvt
                      .| handleEvents testPeer
                      .| sinkList
            `L.shouldReturn` [Left TXQueueTimeout]

  describe "Private Chain Authorization" $ do
    let ip1 = "172.20.44.53"
        ip2 = "33.4.2.1"
        ip3 = "5.9.150.40"
        ip4 = "127.0.0.1"
        key1 = "3414c01c19aa75a34f2dbd2f8d0898dc79d6b219ad77f8155abf1a287ce2ba60f14998a3a98c0cf14915eabfdacf914a92b27a01769de18fa2d049dbf4c17694"
        key2 = "f4642fa65af50cfdea8fa7414a5def7bb7991478b768e296f5e4a54e8b995de102e0ceae2e826f293c481b5325f89be6d207b003382e18a8ecba66fbaf6416c0"
        key3 = "a4de274d3a159e10c2c9a68c326511236381b84c9ec52e72ad732eb0b2b1a2277938f78593cdbe734e6002bf23114d434a085d260514ab336d4acdc312db671b"
        key4 = "a979fb575495b8d6db44f750317d0f4622bf4c2aa3365d6af7c284339968eef29b69ad0dce72a4d8db5ebb4968de0e3bec910127f134779fbcb0cb6d3331163c"
        mkEnode :: String -> String -> Enode
        mkEnode key ip = readEnode $ printf "enode://%s@%s:30303" key ip
        chainMembers = M.fromList
           [ (0xdeadbeef, mkEnode key1 ip1)
           , (0xddba11, mkEnode key2 ip2)
           , (0x888, mkEnode key3 ip3)
           ]

        shouldAccept :: AuthorizationMode -> (String, String) -> IO ()
        shouldAccept mode (key, ip) =
          DataPeer.buildPeer (Just key, ip, 30303) `shouldSatisfy` (\p -> checkPeerIsMember' mode p $ ChainMembers chainMembers)

        shouldReject :: AuthorizationMode -> (String, String) -> IO ()
        shouldReject mode (key, ip) =
          DataPeer.buildPeer (Just key, ip, 30303) `shouldNotSatisfy` (\p -> checkPeerIsMember' mode p $ ChainMembers chainMembers)

    describe "IPOnly" $ do
      it "should reject the wrong ip" $ IPOnly `shouldReject` (key1, ip4)
      it "should accept the right ip with the wrong key" $ IPOnly `shouldAccept` (key4, ip2)

    describe "PubkeyOnly" $ do
      it "should reject the wrong key" $ PubkeyOnly `shouldReject` (key4, ip1)
      it "should accept the right key with the wrong ip" $ PubkeyOnly `shouldAccept` (key2, ip4)

    describe "StrongAuth" $ do
      it "should reject a mismatched ip, key pair" $ StrongAuth `shouldReject` (key3, ip2)
      it "should accept a matching ip, key pair" $ StrongAuth `shouldAccept` (key3, ip3)

    describe "FlexibleAuth" $ do
      it "should reject a wrong ip and wrong key" $ FlexibleAuth `shouldReject` (key4, ip4)
      it "should accept a matching ip" $ FlexibleAuth `shouldAccept` (key4, ip1)
      it "should accept a matching key" $ FlexibleAuth `shouldAccept` (key2, ip4)
