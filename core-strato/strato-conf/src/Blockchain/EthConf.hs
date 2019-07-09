{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.EthConf
  ( module Blockchain.EthConf.Model
  , module Blockchain.EthConf
  ) where

import           Control.Monad.Except       (ExceptT (..))
import           Control.Monad.Trans.State
import qualified Data.ByteString            as B
import qualified Data.ByteString.Char8      as B8
import           Data.String
import           Data.Yaml
import qualified Database.Redis             as Redis
import           Network.Kafka
import qualified Network.Kafka.Protocol     as KP
import           System.IO.Unsafe

import           Blockchain.EthConf.Model


{- CONFIG: first change, make this local -}

-- noinline cause its not like we had any guarantee of whether or not the file
-- got re-read anyway
{-# NOINLINE ethConf #-}
ethConf :: EthConf
ethConf = unsafePerformIO $ do
    contents <- B.readFile ".ethereumH/ethconf.yaml"
    return $ (either (error.show) id . decodeEither') contents


{- CONFIG: clobber connection string -}


connStr :: B.ByteString
connStr = postgreSQLConnectionString . sqlConfig $ ethConf

runKafkaConfigured :: KafkaClientId -> StateT KafkaState (ExceptT KafkaClientError IO) a -> IO (Either KafkaClientError a)
runKafkaConfigured name = runKafka (mkConfiguredKafkaState name)

mkConfiguredKafkaState :: KafkaClientId -> KafkaState
mkConfiguredKafkaState cid = (mkKafkaState cid (kh, kp)) { _stateRequiredAcks = -1, _stateWaitSize = 1, _stateWaitTime = 100000}
    where k = kafkaConfig ethConf
          kh = fromString $ kafkaHost k
          kp = fromIntegral $ kafkaPort k

lookupConsumerGroup :: KafkaClientId -> KP.ConsumerGroup
lookupConsumerGroup "slipstream" = KP.ConsumerGroup "slipstream"
lookupConsumerGroup kcid = KP.ConsumerGroup . KP.KString $ kStr `B8.append` nodeId
    where kStr   = KP._kString kcid
          nodeId = B8.pack $ "_" ++ peerId (ethUniqueId ethConf)

lookupRedisBlockDBConfig :: Redis.ConnectInfo
lookupRedisBlockDBConfig = redisConnection $ redisBlockDBConfig ethConf
