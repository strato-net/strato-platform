{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE GADTs                 #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TypeFamilies          #-}
{-# OPTIONS_GHC -fno-warn-orphans       #-}

module Blockchain.Stream.VMOutput (
  VMOutput(..),
  produceVMOutputs,
  produceVMOutputsM,
  fetchVMOutputs,
--  fetchVMOutputs',
--  fetchVMOutputsIO,
--  fetchVMOutputsOneIO,
  fetchLastVMOutputs,
--  fetchVMOutputsFromTopic,
--  defaultVMOutputsTopicName,
  getBestKafkaBlockNumber,
  HasVMOutputsSink(..)
) where

import           Conduit
import           Control.Monad.Change.Modify (Modifiable)
import           Control.Monad.State
import qualified Data.ByteString             as B
import qualified Data.ByteString.Lazy        as BL

import           Network.Kafka
import           Network.Kafka.Producer
import           Network.Kafka.Protocol      hiding (Key)

import           BlockApps.Logging
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Block
import           Blockchain.Data.RLP
import           Blockchain.EthConf
import           Blockchain.KafkaTopics
import           Blockchain.MilenaTools
import           Blockchain.Stream.Raw
import           Text.Format



import qualified Data.Binary                 as Binary

data VMOutput = ChainBlock Block | NewUnminedBlockAvailable

instance Format VMOutput where
  format (ChainBlock b)           = "Block: " ++ format b
  format NewUnminedBlockAvailable = "<NewUnminedBlockAvailable>"

instance Binary.Binary VMOutput where
    get = Binary.getWord8 >>= \case
        0 -> ChainBlock . rlpDecode . rlpDeserialize <$> Binary.get
        1 -> return NewUnminedBlockAvailable
        b -> error $ "VMOutput has unexpected tag: " ++ show b

    put NewUnminedBlockAvailable = Binary.putWord8 1
    put (ChainBlock b) = do
        Binary.putWord8 0
        Binary.put . rlpSerialize $ rlpEncode b

-- todo: get rid of these next two completely and use Binary.encode/decode in their place everywhere else
bytesToVMOutput :: B.ByteString -> VMOutput
bytesToVMOutput = Binary.decode . BL.fromStrict

vmOutputToBytes :: VMOutput -> B.ByteString
vmOutputToBytes = BL.toStrict . Binary.encode

class HasVMOutputsSink k where
  getVMOutputsSink :: k ([VMOutput] -> k ())

produceVMOutputsM :: (Modifiable KafkaState m, MonadLogger m, MonadIO m) => [VMOutput] -> m Offset
produceVMOutputsM vmOutputs = do
    x <- withKafkaRetry1s . produceMessagesAsSingletonSets $
        map (TopicAndMessage (lookupTopic "block") . makeMessage . vmOutputToBytes) vmOutputs

    let [offset] = concatMap (map (\(_, _, x') ->x') . concatMap snd . _produceResponseFields) x
    return offset

-- todo: refactor this to consume produceVMOutputsM
produceVMOutputs::(MonadIO m)=>[VMOutput]->m Offset
produceVMOutputs vmOutputs = do
  result <- liftIO $ runKafkaConfigured "blockapps-data" $
            produceMessagesAsSingletonSets $ map (TopicAndMessage (lookupTopic "block") . makeMessage . vmOutputToBytes) vmOutputs

  case result of
   Left e -> error $ show e
   Right x -> do
     let [offset] = concatMap (map (\(_, _, x') ->x') . concatMap snd . _produceResponseFields) x
     return offset

-- | Reads VMOutputs from `defaultVMOutputsTopicName`
fetchVMOutputs :: Kafka k => Offset -> k [VMOutput]
fetchVMOutputs = fetchVMOutputsFromTopic defaultVMOutputsTopicName

{-
-- | Same as `fetchVMOutputs`, except sets our commonly-used Milena state configurations
fetchVMOutputs' :: Kafka k => Offset -> k [VMOutput]
fetchVMOutputs' ofs = fetchVMOutputsFromTopic defaultVMOutputsTopicName ofs
-}

fetchVMOutputsFromTopic :: Kafka k => TopicName -> Offset -> k [VMOutput]
fetchVMOutputsFromTopic topic offset = map bytesToVMOutput <$> fetchBytes topic offset

defaultVMOutputsTopicName :: TopicName
defaultVMOutputsTopicName = lookupTopic "block"

fetchVMOutputsRange :: Kafka k => Offset -> Offset -> k [VMOutput]
fetchVMOutputsRange lower upper = do
  events <- fetchVMOutputs lower

  let returned = length events
      newOffset = lower + fromIntegral returned
  if newOffset >= upper
    then return (take (fromIntegral upper - fromIntegral lower + 1) events)
    else do
      events' <- fetchVMOutputsRange newOffset upper
      return (events ++ events')

{-
fetchVMOutputsIO::Offset->IO (Maybe [VMOutput])
fetchVMOutputsIO offset =
  fmap (map bytesToVMOutput) <$> fetchBytesIO (lookupTopic "block") offset

fetchVMOutputsOneIO::Offset->IO (Maybe VMOutput)
fetchVMOutputsOneIO offset =
  fmap bytesToVMOutput <$> fetchBytesOneIO (lookupTopic "block") offset
-}

fetchLastVMOutputs::Offset->IO [VMOutput]
fetchLastVMOutputs n = do
  ret <-
    runKafkaConfigured "strato-p2p-client" $ do
      lastOffset <- getLastOffset LatestTime 0 (lookupTopic "block")
      when (lastOffset == 0) $ error "Block stream is empty, you need to run strato-setup to insert the genesis block."
      let offset = max (lastOffset - n) 0
      fetchVMOutputs offset

  case ret of
    Left e  -> error $ show e
    Right v -> return v

lookback :: Offset
lookback = 1000

getBestKafkaBlockNumber:: IO Integer
getBestKafkaBlockNumber = do
  lastOffset <- runKafkaConfigured "strato-p2p-client" $ getLastOffset LatestTime 0 (lookupTopic "block")

  case lastOffset of
    Left e       -> error $ show e
    Right offset -> go (max (offset-lookback) 0) offset

  where
    go m n = do
      maybeBestBlockNumber <- getBestKafkaBlockHelper m n
      case maybeBestBlockNumber of
        (Just n') -> return n'
        Nothing   -> go (max (m-lookback) 0) m


getBestKafkaBlockHelper::Offset->Offset->IO (Maybe Integer)
getBestKafkaBlockHelper lower upper = do
  vmOutputsErr <-
    runKafkaConfigured "strato-p2p-client" $ fetchVMOutputsRange lower upper

  case vmOutputsErr of
    Left e -> error $ show e
    Right vmOutputs -> do
      let blocks = [ b | ChainBlock b <- vmOutputs ]
      case blocks of
        [] -> return Nothing
        xs -> return . Just $ maximum (map (blockDataNumber . blockBlockData) xs)
