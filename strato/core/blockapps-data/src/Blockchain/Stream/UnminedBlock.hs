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

produceUnminedBlocksM :: (Kafka m) => [Block] -> m ()
produceUnminedBlocksM blks = do
  results <- fmap concat $ forM blks $ \b -> produceMessages [TopicAndMessage (lookupTopic "unminedblock") . makeMessage . rlpSerialize . rlpEncode $ b]
  liftIO $ mapM_ parseKafkaResponse $ results -- type [Either [KafkaError] ProduceResponse]

fetchUnminedBlocks :: Kafka k => Offset -> k [Block]
fetchUnminedBlocks = fmap (map (rlpDecode . rlpDeserialize)) . fetchBytes (lookupTopic "unminedblock")

fetchUnminedBlocksIO :: Offset -> IO (Maybe [Block])
fetchUnminedBlocksIO offset =
    fmap (map (rlpDecode . rlpDeserialize)) <$> fetchBytesIO (lookupTopic "unminedblock") offset
