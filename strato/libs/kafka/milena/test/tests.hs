{-# LANGUAGE OverloadedStrings #-}

module Main where

import Prelude

-- base
import Data.Either (isRight, isLeft)
import qualified Data.List.NonEmpty as NE

-- Hackage
import Control.Lens
import Control.Monad.Except (catchError, throwError)
import Control.Monad.Trans (liftIO)
import Test.Tasty
import Test.Tasty.Hspec
import Test.Tasty.QuickCheck
import qualified Data.ByteString.Char8 as B

-- local
import Network.Kafka
import Network.Kafka.Consumer
import Network.Kafka.Producer
import Network.Kafka.Protocol (ProduceResponse(..),
                               KafkaError(..),
                               CompressionCodec(..),
                               CreateTopicsResponse(..),
                               DeleteTopicsResponse(..),
                               Offset(..),
                               OffsetCommitResponse(..),
                               OffsetFetchResponse(..),
                               ConsumerGroup(..),
                               Partition(..),
                               KafkaString(..),
                               Metadata(..),
                               TopicName(..),
                               HeartbeatResponse(..),
                              )



main :: IO ()
main = testSpec "the specs" specs >>= defaultMain

specs :: Spec
specs = do
  let topic = "milena-test"
      run = runKafka $ mkKafkaState "milena-test-client" ("localhost", 9092)
      requireAllAcks = do
        stateRequiredAcks .= -1
        stateWaitSize .= 1
        stateWaitTime .= 1000
      byteMessages = fmap (TopicAndMessage topic . makeMessage . B.pack)

  let cleanup :: TopicName -> IO ()
      cleanup topicName = do
          _ <- run $ do
                   stateAddresses %= NE.cons ("localhost", 9092)
                   deleteTopic (deleteTopicsRequest topicName)
          pure ()

  describe "can talk to local Kafka server" $ do
    prop "can produce messages" $ \ms -> do
      result <- run . produceMessages $ byteMessages ms
      result `shouldSatisfy` isRight

    prop "can produce compressed messages" $ \ms -> do
      result <- run . produceCompressedMessages Gzip $ byteMessages ms
      result `shouldSatisfy` isRight

    prop "can produce multiple messages" $ \(ms, ms', ms'') -> do
      result <- run $ do
        r1 <- produceMessages $ byteMessages ms
        r2 <- produceMessages $ byteMessages ms'
        r3 <- produceCompressedMessages Gzip $  byteMessages ms''
        return $ r1 ++ r2 ++ r3
      result `shouldSatisfy` isRight

    prop "can fetch messages" $ do
      result <- run $ do
        offset <- getLastOffset EarliestTime 0 topic
        withAnyHandle (\handle -> fetch' handle =<< fetchRequest offset 0 topic)
      result `shouldSatisfy` isRight

    prop "can roundtrip messages" $ \ms key -> do
      let messages = byteMessages ms
      result <- run $ do
        requireAllAcks
        info <- brokerPartitionInfo topic

        case getPartitionByKey (B.pack key) info of
          Just PartitionAndLeader { _palLeader = leader, _palPartition = partition } -> do
            let payload = [(TopicAndPartition topic partition, groupMessagesToSet NoCompression messages)]
                s = stateBrokers . at leader
            [(_topicName, [(_, NoError, offset)])] <- _produceResponseFields <$> send leader payload
            broker <- findMetadataOrElse [topic] s (KafkaInvalidBroker leader)
            resp <- withBrokerHandle broker (\handle -> fetch' handle =<< fetchRequest offset partition topic)
            return $ fmap tamPayload . fetchMessages $ resp

          Nothing -> fail "Could not deduce partition"

      result `shouldBe` Right (tamPayload <$> messages)

    prop "can roundtrip compressed messages" $ \(NonEmpty ms) -> do
      let messages = byteMessages ms
      result <- run $ do
        requireAllAcks
        produceResps <- produceCompressedMessages Gzip messages

        case map _produceResponseFields produceResps of
          [[(_topicName, [(partition, NoError, offset)])]] -> do
            resp <- fetch offset partition topic
            return $ fmap tamPayload . fetchMessages $ resp

          _ -> fail "Unexpected produce response"

      result `shouldBe` Right (tamPayload <$> messages)

    prop "can roundtrip keyed messages" $ \(NonEmpty ms) key -> do
      let keyBytes = B.pack key
          messages = fmap (TopicAndMessage topic . makeKeyedMessage keyBytes . B.pack) ms
      result <- run $ do
        requireAllAcks
        produceResps <- produceMessages messages

        case map _produceResponseFields produceResps of
          [[(_topicName, [(partition, NoError, offset)])]] -> do
            resp <- fetch offset partition topic
            return $ fmap tamPayload . fetchMessages $ resp

          _ -> fail "Unexpected produce response"

      result `shouldBe` Right (tamPayload <$> messages)

  describe "withAddressHandle" $ do
    it "turns 'IOException's into 'KafkaClientError's" $ do
      result <- run $ withAddressHandle ("localhost", 9092) (\_ -> liftIO $ ioError $ userError "SOMETHING WENT WRONG!") :: IO (Either KafkaClientError ())
      result `shouldSatisfy` isLeft

    it "discards monadic effects when exceptions are thrown" $ do
      result <- run $ do
        stateName .= "expected"
        _ <- flip catchError (return . Left) $ withAddressHandle ("localhost", 9092) $ \_ -> do
          stateName .= "changed"
          _ <- throwError KafkaFailedToFetchMetadata
          n <- use stateName
          return (Right n)
        use stateName
      result `shouldBe` Right "expected"

  describe "updateMetadatas" $
    it "de-dupes _stateAddresses" $ do
      result <- run $ do
        stateAddresses %= NE.cons ("localhost", 9092)
        updateMetadatas []
        use stateAddresses
      result `shouldBe` fmap NE.nub result


  let newTopicName = "milena-test-13-partitions"
  describe "create topics" $ do
    it "create topics with multiple partitions" $ do
      result <- run $ do
        stateAddresses %= NE.cons ("localhost", 9092)
        createTopic (createTopicsRequest newTopicName 13 1 [] [])
      result `shouldBe` (Right $ TopicsResp [(newTopicName, NoError)])

    it "create already existing topic" $ do
      result <- run $ do
        stateAddresses %= NE.cons ("localhost", 9092)
        createTopic (createTopicsRequest newTopicName 13 1 [] [])
      result `shouldBe` (Right $ TopicsResp [(newTopicName, TopicAlreadyExists)])

  describe "delete topics" $
    it "delete topics" $ do
      result <- run $ do
        stateAddresses %= NE.cons ("localhost", 9092)
        deleteTopic (deleteTopicsRequest newTopicName)
      result `shouldBe` (Right $ DeleteTopicsResp [(newTopicName, NoError)])

  describe "heartbeat" $
    it "heart response" $ do
      result <- run $ do
        stateAddresses %= NE.cons ("localhost", 9092)
        heartbeat (heartbeatRequest "non-existent-group-id" 143 "fake-member-id")
      result `shouldBe` (Right $ HeartbeatResp UnknownMemberId)

  let commitOffsetTopicName = "commit-offset"
      t = commitOffsetTopicName

  Test.Tasty.Hspec.afterAll_ (cleanup commitOffsetTopicName) $ do
    describe "can commit messages" $ do
      it "create a topic" $ do
        topicCreation <- run $ do
          stateAddresses %= NE.cons ("localhost", 9092)
          createTopic (createTopicsRequest t 3 1 [] [])
        topicCreation `shouldBe` (Right $ TopicsResp [(t, NoError)])

      it "commit offset 5 to partition 0 for consumer group \"group1\"" $ do
        commitOff <- run $ do
            stateAddresses %= NE.cons ("localhost", 9092)
            commitOffset (commitOffsetRequest (ConsumerGroup "group1") t 0 (Offset 5))
        commitOff `shouldBe` Right (OffsetCommitResp [(t,[(Partition 0,NoError)])])

      it "commit offset 15 to partition 1 for consumer group \"group1\"" $ do
        commitOff <- run $ do
            stateAddresses %= NE.cons ("localhost", 9092)
            commitOffset (commitOffsetRequest (ConsumerGroup "group1") t 1 (Offset 15))
        commitOff `shouldBe` Right (OffsetCommitResp [(t,[(Partition 1,NoError)])])

      it "commit offset 10 to partition 2 for consumer group \"group2\"" $ do
        commitOff <- run $ do
            stateAddresses %= NE.cons ("localhost", 9092)
            commitOffset (commitOffsetRequest (ConsumerGroup "group2") t 2 10)
        commitOff `shouldSatisfy` isRight

      it "fetch offset from partition 0 for \"group1\"" $ do
        fetchOff <- run $ do
            stateAddresses %= NE.cons ("localhost", 9092)
            fetchOffset (fetchOffsetRequest (ConsumerGroup "group1") t 0)
        fetchOff `shouldBe` Right (OffsetFetchResp [(t,[(Partition 0, Offset 5,Metadata (KString {_kString = ""}),NoError)])])

      it "fetch offset from partition 0 for \"group2\"" $ do
        fetchOff <- run $ do
            stateAddresses %= NE.cons ("localhost", 9092)
            fetchOffset (fetchOffsetRequest (ConsumerGroup "group2") t 0)
        fetchOff `shouldBe` Right (OffsetFetchResp [(t,[(Partition 0, Offset (-1),Metadata (KString {_kString = ""}),UnknownTopicOrPartition)])])

      it "note that getLastOffset is unchanged" $ do
        getLastOff <- run $ do
            stateAddresses %= NE.cons ("localhost", 9092)
            getLastOffset EarliestTime 0 t
        getLastOff `shouldSatisfy` isRight
        getLastOff `shouldBe` (Right $ Offset 0)

prop :: Testable prop => String -> prop -> SpecWith ()
prop s = it s . property
