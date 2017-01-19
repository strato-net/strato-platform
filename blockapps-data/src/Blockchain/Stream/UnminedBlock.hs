{-# LANGUAGE FlexibleContexts, OverloadedStrings #-}

module Blockchain.Stream.UnminedBlock (
  produceUnminedBlocks,
  produceUnminedBlocksM,
  fetchUnminedBlocks,
  fetchUnminedBlocksIO
) where 

import Network.Kafka
import Network.Kafka.Producer
import Network.Kafka.Protocol hiding (Key)

import Blockchain.Stream.Raw
import Blockchain.Data.BlockDB
import Blockchain.Data.RLP

import Control.Monad.State
import Blockchain.KafkaTopics
import Blockchain.EthConf

produceUnminedBlocks :: MonadIO m => [Block] -> m ()
produceUnminedBlocks = void . liftIO . runKafkaConfigured "blockapps-data" . produceUnminedBlocksM

produceUnminedBlocksM :: Kafka k => [Block] -> k ()
produceUnminedBlocksM = void . produceMessages . fmap makeMessage'
    where makeMessage' = TopicAndMessage (lookupTopic "unminedblock") . makeMessage . rlpSerialize . rlpEncode

fetchUnminedBlocks :: Kafka k => Offset -> k [Block]
fetchUnminedBlocks = fmap (map (rlpDecode . rlpDeserialize)) . fetchBytes (lookupTopic "unminedblock")

fetchUnminedBlocksIO :: Offset -> IO (Maybe [Block])
fetchUnminedBlocksIO offset =
    fmap (map (rlpDecode . rlpDeserialize)) <$> fetchBytesIO (lookupTopic "unminedblock") offset
