{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE GADTs                 #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TypeFamilies          #-}
{-# OPTIONS_GHC -fno-warn-orphans       #-}

module Blockchain.Stream.VMEvent (
  VMEvent(..),
  produceVMEvents,
  produceVMEventsM,
  fetchVMEvents,
  fetchVMEvents',
  fetchVMEventsIO,
  fetchVMEventsOneIO,
  fetchLastVMEvents,
  fetchVMEventsFromTopic,
  defaultVMEventsTopicName,
  getBestKafkaBlockNumber,
  HasVMEventsSink(..)
) where

import           Conduit

import qualified Data.ByteString             as B
import qualified Data.ByteString.Lazy        as BL

import           Network.Kafka
import           Network.Kafka.Producer
import           Network.Kafka.Protocol      hiding (Key)

import           Blockchain.Data.BlockDB
import           Blockchain.Data.RLP
import           Blockchain.EthConf
import           Blockchain.Format
import           Blockchain.KafkaTopics
import           Blockchain.MilenaTools
import           Blockchain.Stream.Raw


import           Control.Monad.State

import qualified Data.Binary                 as Binary

data VMEvent = ChainBlock Block | NewUnminedBlockAvailable

instance Format VMEvent where
  format (ChainBlock b)           = "Block: " ++ format b
  format NewUnminedBlockAvailable = "<NewUnminedBlockAvailable>"

instance Binary.Binary VMEvent where
    get = Binary.getWord8 >>= \case
        0 -> ChainBlock . rlpDecode . rlpDeserialize <$> Binary.get
        1 -> return NewUnminedBlockAvailable
        b -> error $ "VMEvent has unexpected tag: " ++ show b

    put NewUnminedBlockAvailable = Binary.putWord8 1
    put (ChainBlock b) = do
        Binary.putWord8 0
        Binary.put . rlpSerialize $ rlpEncode b

-- todo: get rid of these next two completely and use Binary.encode/decode in their place everywhere else
bytesToVMEvent :: B.ByteString -> VMEvent
bytesToVMEvent = Binary.decode . BL.fromStrict

vmEventToBytes :: VMEvent -> B.ByteString
vmEventToBytes = BL.toStrict . Binary.encode

class HasVMEventsSink k where
  getVMEventsSink :: k ([VMEvent] -> k ())

produceVMEventsM :: (HasKafkaState m, MonadIO m) => [VMEvent] -> m Offset
produceVMEventsM vmEvents = do
    x <- withKafkaViolently . produceMessages $
        map (TopicAndMessage (lookupTopic "block") . makeMessage . vmEventToBytes) vmEvents

    let [offset] = concatMap (map (\(_, _, x') ->x') . concatMap snd . _produceResponseFields) x
    return offset

-- todo: refactor this to consume produceVMEventsM
produceVMEvents::(MonadIO m)=>[VMEvent]->m Offset
produceVMEvents vmEvents = do
  result <- liftIO $ runKafkaConfigured "blockapps-data" $
            produceMessages $ map (TopicAndMessage (lookupTopic "block") . makeMessage . vmEventToBytes) vmEvents

  case result of
   Left e -> error $ show e
   Right x -> do
     let [offset] = concatMap (map (\(_, _, x') ->x') . concatMap snd . _produceResponseFields) x
     return offset

-- | Reads VMEvents from `defaultVMEventsTopicName`
fetchVMEvents :: Kafka k => Offset -> k [VMEvent]
fetchVMEvents = fetchVMEventsFromTopic defaultVMEventsTopicName

-- | Same as `fetchVMEvents`, except sets our commonly-used Milena state configurations
fetchVMEvents' :: Kafka k => Offset -> k [VMEvent]
fetchVMEvents' ofs = do
    setDefaultKafkaState
    fetchVMEventsFromTopic defaultVMEventsTopicName ofs

fetchVMEventsFromTopic :: Kafka k => TopicName -> Offset -> k [VMEvent]
fetchVMEventsFromTopic topic offset = map bytesToVMEvent <$> fetchBytes topic offset

defaultVMEventsTopicName :: TopicName
defaultVMEventsTopicName = lookupTopic "block"

fetchVMEventsRange :: Kafka k => Offset -> Offset -> k [VMEvent]
fetchVMEventsRange lower upper = do
  events <- fetchVMEvents lower

  let returned = length events
      newOffset = lower + fromIntegral returned
  if newOffset >= upper
    then return (take (fromIntegral upper - fromIntegral lower + 1) events)
    else do
      events' <- fetchVMEventsRange newOffset upper
      return (events ++ events')

fetchVMEventsIO::Offset->IO (Maybe [VMEvent])
fetchVMEventsIO offset =
  fmap (map bytesToVMEvent) <$> fetchBytesIO (lookupTopic "block") offset

fetchVMEventsOneIO::Offset->IO (Maybe VMEvent)
fetchVMEventsOneIO offset =
  fmap bytesToVMEvent <$> fetchBytesOneIO (lookupTopic "block") offset

fetchLastVMEvents::Offset->IO [VMEvent]
fetchLastVMEvents n = do
  ret <-
    runKafkaConfigured "strato-p2p-client" $ do
      setDefaultKafkaState
      lastOffset <- getLastOffset LatestTime 0 (lookupTopic "block")
      when (lastOffset == 0) $ error "Block stream is empty, you need to run strato-setup to insert the genesis block."
      let offset = max (lastOffset - n) 0
      fetchVMEvents offset

  case ret of
    Left e  -> error $ show e
    Right v -> return v

lookback :: Offset
lookback = 1000

getBestKafkaBlockNumber:: IO Integer
getBestKafkaBlockNumber = do
  lastOffset <-
    runKafkaConfigured "strato-p2p-client" $
      setDefaultKafkaState >> getLastOffset LatestTime 0 (lookupTopic "block")

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
  vmEventsErr <-
    runKafkaConfigured "strato-p2p-client" $ do
      setDefaultKafkaState
      fetchVMEventsRange lower upper

  case vmEventsErr of
    Left e -> error $ show e
    Right vmEvents -> do
      let blocks = [ b | ChainBlock b <- vmEvents ]
      case blocks of
        [] -> return Nothing
        xs -> return . Just $ maximum (map (blockDataNumber . blockBlockData) xs)
