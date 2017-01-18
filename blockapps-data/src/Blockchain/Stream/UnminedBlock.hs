{-# LANGUAGE OverloadedStrings, ForeignFunctionInterface #-}
{-# LANGUAGE EmptyDataDecls             #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE GADTs                      #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}
{-# LANGUAGE ScopedTypeVariables        #-}
{-# OPTIONS_GHC -fno-warn-orphans       #-}


module Blockchain.Stream.UnminedBlock (
  produceUnminedBlocks,
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
produceUnminedBlocks blocks = forM_ blocks $ \block ->
    void $ liftIO $ runKafkaConfigured "blockapps-data" $ produceMessages [TopicAndMessage (lookupTopic "unminedblock") $ makeMessage $ rlpSerialize $ rlpEncode $ block]

fetchUnminedBlocks :: Kafka k => Offset -> k [Block]
fetchUnminedBlocks = fmap (map (rlpDecode . rlpDeserialize)) . fetchBytes (lookupTopic "unminedblock")

fetchUnminedBlocksIO :: Offset -> IO (Maybe [Block])
fetchUnminedBlocksIO offset =
    fmap (map (rlpDecode . rlpDeserialize)) <$> fetchBytesIO (lookupTopic "unminedblock") offset
