{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Stream.UnminedBlock (
  produceUnminedBlocks,
  produceUnminedBlocksM,
  fetchUnminedBlocks,
  fetchUnminedBlocksIO
) where
import           Control.Monad

import           Network.Kafka
import           Network.Kafka.Producer
import           Network.Kafka.Protocol  hiding (Key)

import           Blockchain.Data.Block
import           Blockchain.Data.RLP
import           Blockchain.Stream.Raw

import           Blockchain.EthConf
import           Blockchain.KafkaTopics
import           Control.Monad.State
import           Blockchain.MilenaTools


produceUnminedBlocks :: MonadIO m => [Block] -> m ()
produceUnminedBlocks = void . liftIO . runKafkaConfigured "blockapps-data" . produceUnminedBlocksM

produceUnminedBlocksM :: (Kafka k) => [Block] -> k ()
produceUnminedBlocksM blks = do
  results <- fmap concat $ forM blks $ \b -> produceMessages [TopicAndMessage (lookupTopic "unminedblock") . makeMessage . rlpSerialize . rlpEncode $ b]
  mapM_ parseKafkaResponse results -- type [Either [KafkaError] ProduceResponse]
  -- when (any (/= NoError) $ mapResults parsedResults) $ void $ error $ "Error: Kafka write failed: " ++ show parsedResults
  -- return ()
  -- void . produceMessages . fmap makeMessage'
  --   where makeMessage' = TopicAndMessage (lookupTopic "unminedblock") . makeMessage . rlpSerialize . rlpEncode
  -- where mapResults :: [Either [KafkaError] ProduceResponse] -> [KafkaError]
  --       mapResults [] = [NoError]
  --       mapResults (Left es : xs)= es ++ mapResults xs
  --       mapResults (Right _ : xs) = [NoError] ++ mapResults xs
fetchUnminedBlocks :: Kafka k => Offset -> k [Block]
fetchUnminedBlocks = fmap (map (rlpDecode . rlpDeserialize)) . fetchBytes (lookupTopic "unminedblock")

fetchUnminedBlocksIO :: Offset -> IO (Maybe [Block])
fetchUnminedBlocksIO offset =
    fmap (map (rlpDecode . rlpDeserialize)) <$> fetchBytesIO (lookupTopic "unminedblock") offset
