{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Blockchain.EthConf.Model where

-- These are the aspects EthConf that don't require unsafePerformIO

import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as C8
import Data.Default
import Data.Ratio
import Data.Yaml
import qualified Database.PostgreSQL.Simple as PS (ConnectInfo (..), postgreSQLConnectionString)
import qualified Database.Redis as Redis
import GHC.Generics

postgreSQLConnectionString :: SqlConf -> B.ByteString
postgreSQLConnectionString sqlc =
  PS.postgreSQLConnectionString
    PS.ConnectInfo
      { PS.connectHost = host sqlc,
        PS.connectPort = fromIntegral $ port sqlc,
        PS.connectUser = user sqlc,
        PS.connectPassword = password sqlc,
        PS.connectDatabase = database sqlc
      }

redisConnection :: RedisBlockDBConf -> Redis.ConnectInfo
redisConnection r =
  Redis.defaultConnectInfo
    { Redis.connectHost = redisHost r,
      Redis.connectPort = Redis.PortNumber $ fromIntegral (redisPort r),
      Redis.connectAuth = C8.pack <$> redisAuth r,
      Redis.connectDatabase = redisDBNumber r,
      Redis.connectMaxConnections = redisMaxConnections r,
      Redis.connectMaxIdleTime = fromRational (redisMaxIdleTime r % 1)
    }

data EthConf = EthConf
  { sqlConfig :: SqlConf,
    cirrusConfig :: SqlConf,
    redisBlockDBConfig :: RedisBlockDBConf,
    kafkaConfig :: KafkaConf,
    levelDBConfig :: LevelDBConf,
    p2pConfig :: P2PConfig,
    quarryConfig :: QuarryConf,
    blockConfig :: BlockConf,
    discoveryConfig :: DiscoveryConf,
    apiConfig :: ApiConfig
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data ApiConfig = ApiConfig
  { ipAddress :: String
  } deriving (Show, Eq, Generic, FromJSON, ToJSON)

data DiscoveryConf = DiscoveryConf
  { discoveryPort :: Int,
    minAvailablePeers :: Int
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data P2PConfig = P2PConfig
  {
    listenHost :: String, --Connect to server at address
    listenPort :: Int, --Listen on port
    maxConn :: Int, --Maximum number of client connections.
    connectionTimeout :: Int, --Number of seconds to tolerate a useless peer
    maxReturnedHeaders :: Int, --Number of headers to return from a GetBlockHeaders request
    maxHeadersTxsLens :: Int, --Number of txs size to return from a BlockHeader request
    averageTxsPerBlock :: Int --Average number of txs per block
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

instance Default P2PConfig where
  def =
    P2PConfig {
    listenHost="127.0.0.1",
    listenPort=30303,
    maxConn=20,
    connectionTimeout=30,
    maxReturnedHeaders=500,
    maxHeadersTxsLens=2500,
    averageTxsPerBlock=40
    }

data SqlConf = SqlConf
  { user :: String,
    password :: String,
    host :: String,
    port :: Int,
    database :: String,
    poolsize :: Int
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data KafkaConf = KafkaConf
  { kafkaHost :: String,
    kafkaPort :: Int
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data RedisBlockDBConf = RedisBlockDBConf
  { redisHost :: String,
    redisPort :: Int,
    redisAuth :: Maybe String,
    redisDBNumber :: Integer,
    redisMaxConnections :: Int,
    redisMaxIdleTime :: Integer
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data LevelDBConf = LevelDBConf
  { table :: String,
    path :: String
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data QuarryConf = QuarryConf
  { coinbaseAddress :: String,
    lazyBlocks :: Bool
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data BlockConf = BlockConf
  { blockTime :: Integer,
    minBlockDifficulty :: Integer
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)
