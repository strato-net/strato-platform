{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | Pins how a consumer group that trails another on the same topic is
-- drained before it is retired: the group's backlog is handed over in order,
-- across a segment boundary, the other group's position is untouched, and
-- only once the trailing group is gone does JLog sweep the segment it alone
-- was pinning. This is the reconciliation strato-indexer runs for the
-- @strato-indexer-sql@ checkpoint a 19.6 node or snapshot carries.
module Main (main) where

import Control.Exception (IOException, bracket, try)
import Control.Monad (void)
import Control.Monad.Composable.Base (runEff)
import Control.Monad.Composable.Streaming.JLog
import Control.Monad.IO.Class (liftIO)
import qualified Data.ByteString as BS
import Data.IORef
import Data.List (isSuffixOf)
import System.Directory
import System.FilePath ((</>))
import Test.Hspec

-- | Messages of about 2 KB: a few thousand of them cross JLog's default 4 MB
-- segment limit.
message :: Int -> (Int, BS.ByteString)
message i = (i, BS.replicate 2048 (fromIntegral i))

total :: Int
total = 2500

topic :: TopicName
topic = "events"

withTopicDir :: (FilePath -> IO a) -> IO a
withTopicDir = bracket acquire removeDirectoryRecursive
  where
    acquire = do
      tmp <- getTemporaryDirectory
      let dir = tmp </> "streaming-jlog-test"
      exists <- doesDirectoryExist dir
      if exists then removeDirectoryRecursive dir else return ()
      createDirectoryIfMissing True dir
      return dir

inStream :: FilePath -> StreamM '[] a -> IO a
inStream dir = runEff . runStreamM "test" (dir, 0)

-- | The topic's data segments (8-hex names), not its checkpoints or metastore.
segments :: FilePath -> IO [FilePath]
segments dir = filter isSegment <$> listDirectory (dir </> "events")
  where isSegment f = length f == 8 && not (".idx" `isSuffixOf` f)

main :: IO ()
main = hspec $ do
  describe "drainConsumerGroup" $ do
    it "hands a trailing group its backlog in order, across a segment boundary, and retiring it then frees the segment" $
      withTopicDir $ \dir -> do
        inStream dir $ do
          createTopicAndWait topic
          void $ produceItems topic (map message [1 .. total])
          -- lag stops after its first batch, in the first segment; lead then
          -- consumes everything. lag's checkpoint is what keeps the first
          -- segment on disk once lead has passed it, as the old SQL group's
          -- did on a 19.6 node.
          lagFirst <- runConsume "lag" topic $ \xs -> return (Just (length (xs :: [(Int, BS.ByteString)])))
          liftIO $ lagFirst `shouldSatisfy` (\n -> n > 0 && n < total)
          seen <- liftIO $ newIORef (0 :: Int)
          runConsume "lead" topic $ \xs -> do
            n <- liftIO $ atomicModifyIORef' seen (\k -> (k + length (xs :: [(Int, BS.ByteString)]), k + length xs))
            return $ if n >= total then Just () else Nothing
        segsBefore <- segments dir
        length segsBefore `shouldSatisfy` (>= 2)
        inStream dir $ do
          present <- hasConsumerGroup "lag" topic
          liftIO $ present `shouldBe` True
          replayed <- liftIO $ newIORef []
          n <- drainConsumerGroup "lag" topic $ \xs ->
            liftIO $ modifyIORef' replayed (++ map fst (xs :: [(Int, BS.ByteString)]))
          got <- liftIO $ readIORef replayed
          -- Exactly the messages lag had not consumed, in order.
          liftIO $ got `shouldBe` [total - n + 1 .. total]
          liftIO $ n `shouldBe` length got
          -- Draining again finds nothing; lead's position was not touched.
          again <- drainConsumerGroup "lag" topic (\(_ :: [(Int, BS.ByteString)]) -> return ())
          liftIO $ again `shouldBe` 0
          leadLeft <- drainConsumerGroup "lead" topic (\(_ :: [(Int, BS.ByteString)]) -> return ())
          liftIO $ leadLeft `shouldBe` 0
          removed <- removeConsumerGroup "lag" topic
          liftIO $ removed `shouldBe` True
          gone <- hasConsumerGroup "lag" topic
          liftIO $ gone `shouldBe` False
        segsAfter <- segments dir
        length segsAfter `shouldSatisfy` (< length segsBefore)
    it "seedConsumerGroupFrom leaves a group that has a checkpoint alone, and seeds one that has none" $
      withTopicDir $ \dir ->
        inStream dir $ do
          createTopicAndWait topic
          void $ produceItems topic (map message [1 .. total])
          lagFirst <- runConsume "lag" topic $ \xs -> return (Just (length (xs :: [(Int, BS.ByteString)])))
          seen <- liftIO $ newIORef (0 :: Int)
          runConsume "lead" topic $ \xs -> do
            n <- liftIO $ atomicModifyIORef' seen (\k -> (k + length (xs :: [(Int, BS.ByteString)]), k + length xs))
            return $ if n >= total then Just () else Nothing
          -- lag exists: untouched, its backlog is still there.
          copied <- seedConsumerGroupFrom "lag" "lead" topic
          liftIO $ copied `shouldBe` False
          lagLeft <- drainConsumerGroup "lag" topic (\(_ :: [(Int, BS.ByteString)]) -> return ())
          liftIO $ lagLeft `shouldBe` total - lagFirst
          -- a group with no checkpoint gets lead's, which is at the end.
          seeded <- seedConsumerGroupFrom "newbie" "lead" topic
          liftIO $ seeded `shouldBe` True
          newbieLeft <- drainConsumerGroup "newbie" topic (\(_ :: [(Int, BS.ByteString)]) -> return ())
          liftIO $ newbieLeft `shouldBe` 0
    it "throws on a segment it cannot read instead of passing it for the end of the backlog" $
      withTopicDir $ \dir -> do
        firstSeg <- inStream dir $ do
          createTopicAndWait topic
          void $ produceItems topic (map message [1 .. total])
          void $ runConsume "lag" topic $ \xs -> return (Just (length (xs :: [(Int, BS.ByteString)])))
          seen <- liftIO $ newIORef (0 :: Int)
          runConsume "lead" topic $ \xs -> do
            n <- liftIO $ atomicModifyIORef' seen (\k -> (k + length (xs :: [(Int, BS.ByteString)]), k + length xs))
            return $ if n >= total then Just () else Nothing
          segs <- liftIO $ segments dir
          return $ dir </> "events" </> minimum segs
        -- The segment lag's backlog starts in becomes unreadable.
        origPerms <- getPermissions firstSeg
        setPermissions firstSeg emptyPermissions
        stillReadable <- either (const False) (const True) <$> (try (BS.readFile firstSeg) :: IO (Either IOException BS.ByteString))
        if stillReadable
          then do
            setPermissions firstSeg origPerms
            pendingWith "file permissions are not enforced for this user (root?)"
          else do
            inStream dir (drainConsumerGroup "lag" topic (\(_ :: [(Int, BS.ByteString)]) -> return ()))
              `shouldThrow` anyIOException
            setPermissions firstSeg origPerms
            inStream dir $ do
              kept <- hasConsumerGroup "lag" topic
              liftIO $ kept `shouldBe` True
              -- Readable again: the whole backlog is still there.
              n <- drainConsumerGroup "lag" topic (\(_ :: [(Int, BS.ByteString)]) -> return ())
              liftIO $ n `shouldSatisfy` (> 0)
    it "does nothing for a group the topic does not have" $
      withTopicDir $ \dir ->
        inStream dir $ do
          createTopicAndWait topic
          void $ produceItems topic (map message [1 .. 3])
          present <- hasConsumerGroup "nobody" topic
          liftIO $ present `shouldBe` False
          n <- drainConsumerGroup "nobody" topic (\(_ :: [(Int, BS.ByteString)]) -> return ())
          liftIO $ n `shouldBe` 0
