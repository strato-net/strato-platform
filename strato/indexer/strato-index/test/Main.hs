{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

-- | Pins how strato-indexer treats the @strato-indexer-sql@ checkpoint a
-- 19.6 node or snapshot carries: its backlog is replayed into SQL and only
-- then is the group retired, and a cell that does not hold the writer lease
-- (the previous container's lease still fresh, a standby) retires nothing.
-- The lease and the SQL writer are faked; the JLog topic is real.
module Main (main) where

import BlockApps.Logging (runLogging)
import Blockchain.Strato.Indexer.ApiIndexer
import Blockchain.Strato.Indexer.IContext (targetTopicName)
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import Blockchain.Strato.Model.Keccak256 (hash)
import Control.Exception (bracket)
import Control.Monad (void)
import Control.Monad.Composable.Base (Logger, runEff)
import Control.Monad.Composable.Streaming
import Control.Monad.IO.Class (liftIO)
import qualified Data.ByteString.Char8 as BC
import Data.IORef
import HFlags
import System.Directory
import System.FilePath ((</>))
import Test.Hspec

total :: Int
total = 1500

event :: Int -> IndexEvent
event i = NewBestBlock (hash (BC.pack (show i)), fromIntegral i)

blockNumbers :: [IndexEvent] -> [Int]
blockNumbers es = [fromIntegral n | NewBestBlock (_, n) <- es]

withTopicDir :: (FilePath -> IO a) -> IO a
withTopicDir = bracket acquire removeDirectoryRecursive
  where
    acquire = do
      tmp <- getTemporaryDirectory
      let dir = tmp </> "strato-index-test"
      exists <- doesDirectoryExist dir
      if exists then removeDirectoryRecursive dir else return ()
      createDirectoryIfMissing True dir
      return dir

-- | A stream environment on the directory, with logging.
inStream :: FilePath -> StreamM '[Logger] a -> IO a
inStream dir = runEff . runLogging . runStreamM "test" (dir, 0)

-- | A topic with 'total' events, the SQL group past its first batch and the
-- unified group at the end: the 19.6 shape.
splitEraTopic :: StreamM '[Logger] Int
splitEraTopic = do
  createTopicAndWait targetTopicName
  void $ produceItems targetTopicName (map event [1 .. total])
  sqlFirst <- runConsume sqlConsumerGroup targetTopicName $ \es -> return (Just (length (es :: [IndexEvent])))
  seen <- liftIO $ newIORef (0 :: Int)
  runConsume p2pConsumerGroup targetTopicName $ \es -> do
    n <- liftIO $ atomicModifyIORef' seen (\k -> (k + length (es :: [IndexEvent]), k + length es))
    return $ if n >= total then Just () else Nothing
  return sqlFirst

-- HFlags only sees flags from earlier declaration groups; this splice ends the group.
$(return [])

main :: IO ()
main = do
  -- The logger reads its level from an HFlags flag, as in the executables.
  _ <- $initHFlags "strato-index tests"
  hspec $ do
    describe "awaitLeaseAndReconcileWith" $ do
      it "retires nothing while the previous process's lease is still fresh, then replays and retires once the lease is held" $
        withTopicDir $ \dir -> inStream dir $ do
          sqlFirst <- splitEraTopic
          written <- liftIO $ newIORef []
          let writeSql es = liftIO $ modifyIORef' written (++ blockNumbers es)
          -- Three polls, never held: a fresh lease owned by the previous container.
          kept <- awaitLeaseAndReconcileWith 3 1000 (return False) writeSql
          liftIO $ kept `shouldBe` SqlGroupKept
          stillThere <- hasConsumerGroup sqlConsumerGroup targetTopicName
          liftIO $ stillThere `shouldBe` True
          liftIO $ readIORef written >>= (`shouldBe` [])
          -- The claim succeeds on the third poll: the backlog is replayed, in order, then the group goes.
          polls <- liftIO $ newIORef (0 :: Int)
          let holds = liftIO $ atomicModifyIORef' polls (\k -> (k + 1, k + 1 >= 3))
          retired <- awaitLeaseAndReconcileWith 10 1000 holds writeSql
          liftIO $ retired `shouldBe` SqlGroupRetired (total - sqlFirst)
          liftIO $ readIORef written >>= (`shouldBe` [sqlFirst + 1 .. total])
          gone <- hasConsumerGroup sqlConsumerGroup targetTopicName
          liftIO $ gone `shouldBe` False
          -- The unified group's position was not touched.
          unifiedLeft <- drainConsumerGroup p2pConsumerGroup targetTopicName (\(_ :: [IndexEvent]) -> return ())
          liftIO $ unifiedLeft `shouldBe` 0
      it "a standby (no retries) keeps the group without waiting" $
        withTopicDir $ \dir -> inStream dir $ do
          void splitEraTopic
          outcome <- awaitLeaseAndReconcileWith 0 1000 (return False) (\_ -> return ())
          liftIO $ outcome `shouldBe` SqlGroupKept
          stillThere <- hasConsumerGroup sqlConsumerGroup targetTopicName
          liftIO $ stillThere `shouldBe` True
      it "does nothing on a topic without the old group" $
        withTopicDir $ \dir -> inStream dir $ do
          createTopicAndWait targetTopicName
          void $ produceItems targetTopicName (map event [1 .. 3])
          outcome <- awaitLeaseAndReconcileWith 3 1000 (return True) (\_ -> return ())
          liftIO $ outcome `shouldBe` NoSqlGroup
      it "seeds a missing unified group from the SQL group before anything else, without deleting" $
        withTopicDir $ \dir -> inStream dir $ do
          createTopicAndWait targetTopicName
          void $ produceItems targetTopicName (map event [1 .. total])
          void $ runConsume sqlConsumerGroup targetTopicName $ \es -> return (Just (length (es :: [IndexEvent])))
          outcome <- awaitLeaseAndReconcileWith 0 1000 (return False) (\_ -> return ())
          liftIO $ outcome `shouldBe` SqlGroupKept
          seeded <- hasConsumerGroup p2pConsumerGroup targetTopicName
          liftIO $ seeded `shouldBe` True
          stillThere <- hasConsumerGroup sqlConsumerGroup targetTopicName
          liftIO $ stillThere `shouldBe` True
