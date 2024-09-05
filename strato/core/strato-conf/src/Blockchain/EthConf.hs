{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.EthConf
  (
    ethConf,
    connStr,
    lookupRedisBlockDBConfig,
    cirrusConnStr,
    runKafkaMConfigured,
    module Blockchain.EthConf.Model,
  )
where

import Blockchain.EthConf.Model
import Control.Monad.Composable.Kafka
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import Data.String
import Data.Yaml
import qualified Database.Redis as Redis
import System.IO.Unsafe

{- CONFIG: first change, make this local -}

-- noinline cause its not like we had any guarantee of whether or not the file
-- got re-read anyway
{-# NOINLINE ethConf #-}
ethConf :: EthConf
ethConf = unsafePerformIO $ do
  contents <- B.readFile ".ethereumH/ethconf.yaml"
  return $ (either (error . show) id . decodeEither') contents

{- CONFIG: clobber connection string -}

connStr :: B.ByteString
connStr = postgreSQLConnectionString . sqlConfig $ ethConf

cirrusConnStr :: B.ByteString
cirrusConnStr = postgreSQLConnectionString . cirrusConfig $ ethConf

runKafkaMConfigured :: MonadIO m =>
                       KafkaClientId -> KafkaM m a -> m a
runKafkaMConfigured name =
  let k = kafkaConfig ethConf
  in runKafkaM name (fromString $ kafkaHost k, fromIntegral $ kafkaPort k)

lookupRedisBlockDBConfig :: Redis.ConnectInfo
lookupRedisBlockDBConfig = redisConnection $ redisBlockDBConfig ethConf
