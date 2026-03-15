{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Blockchain.EthConf.Model where

-- These are the aspects EthConf that don't require unsafePerformIO

import Blockchain.Strato.Model.Address (Address)
import qualified Data.Aeson as Aeson
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
    quarryConfig :: QuarryConf,
    discoveryConfig :: DiscoveryConf,
    p2pConfig :: P2PConf,
    apiConfig :: ApiConfig,
    contractsConfig :: Maybe ContractsConf,
    urlConfig :: UrlConfig,
    networkConfig :: NetworkConf,
    debugConfig :: DebugConfig
  }
  deriving (Show, Eq, Generic)

instance FromJSON EthConf where
  parseJSON = withObject "EthConf" $ \v -> EthConf
    <$> v .: "sqlConfig"
    <*> v .: "cirrusConfig"
    <*> v .: "redisBlockDBConfig"
    <*> v .: "kafkaConfig"
    <*> v .:? "levelDBConfig" .!= def
    <*> v .:? "quarryConfig" .!= def
    <*> v .: "discoveryConfig"
    <*> v .:? "p2pConfig" .!= def
    <*> v .: "apiConfig"
    <*> v .:? "contractsConfig"
    <*> v .:? "urlConfig" .!= def
    <*> v .:? "networkConfig" .!= def
    <*> v .:? "debugConfig" .!= def

instance ToJSON EthConf where
  toJSON = Aeson.genericToJSON Aeson.defaultOptions { Aeson.omitNothingFields = True }
  toEncoding = Aeson.genericToEncoding Aeson.defaultOptions { Aeson.omitNothingFields = True }

data ApiConfig = ApiConfig
  { ipAddress :: String
  , httpPort :: Int
  } deriving (Show, Eq, Generic, ToJSON)

instance FromJSON ApiConfig where
  parseJSON = withObject "ApiConfig" $ \v -> ApiConfig
    <$> v .: "ipAddress"
    <*> v .:? "httpPort" .!= 8081

data DiscoveryConf = DiscoveryConf
  { discoveryPort :: Int,
    minAvailablePeers :: Int
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data P2PConf = P2PConf
  { maxConnections :: Int
  , connectionTimeout :: Int
  , maxReturnedHeaders :: Int
  , averageTxsPerBlock :: Int
  , maxHeadersTxsLens :: Int
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

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
    path :: String,
    cacheSize :: Int,
    blockSize :: Int
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data QuarryConf = QuarryConf
  { lazyBlocks :: Bool
  , maxTxsPerBlock :: Integer
  , mempoolLivenessCutoff :: Integer
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data ContractsConf = ContractsConf
  { railgunProxy :: Maybe Address  -- ^ RailgunSmartWallet proxy contract address
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data UrlConfig = UrlConfig
  { vaultUrl :: String
  , fileServerUrl :: String
  , notificationServerUrl :: String
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data NetworkConf = NetworkConf
  { network :: String
  , networkID :: Integer
  , txSizeLimit :: Int
  , gasLimit :: Integer
  , blockPeriodMs :: Int
  , roundPeriodS :: Int
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data DebugConfig = DebugConfig
  { svmTrace :: Bool
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

-- Default instances

instance Default SqlConf where
  def = SqlConf
    { user = "postgres"
    , password = "api"
    , host = "localhost"
    , port = 5432
    , database = "eth"
    , poolsize = 10
    }

instance Default KafkaConf where
  def = KafkaConf
    { kafkaHost = "localhost"
    , kafkaPort = 9092
    }

instance Default RedisBlockDBConf where
  def = RedisBlockDBConf
    { redisHost = "localhost"
    , redisPort = 6379
    , redisAuth = Nothing
    , redisDBNumber = 0
    , redisMaxConnections = 10
    , redisMaxIdleTime = 30
    }

instance Default LevelDBConf where
  def = LevelDBConf
    { table = ""
    , path = ""
    , cacheSize = 33554432  -- 32 MiB
    , blockSize = 4096      -- 4 KiB
    }

instance Default QuarryConf where
  def = QuarryConf
    { lazyBlocks = False
    , maxTxsPerBlock = 500
    , mempoolLivenessCutoff = 60  -- seconds
    }

instance Default DiscoveryConf where
  def = DiscoveryConf
    { discoveryPort = 30303
    , minAvailablePeers = 0
    }

instance Default P2PConf where
  def = P2PConf
    { maxConnections = 1000
    , connectionTimeout = 3600
    , maxReturnedHeaders = 500
    , averageTxsPerBlock = 40
    , maxHeadersTxsLens = 2500
    }

instance Default ApiConfig where
  def = ApiConfig
    { ipAddress = "127.0.0.1"
    , httpPort = 8081
    }

instance Default DebugConfig where
  def = DebugConfig
    { svmTrace = False
    }

instance Default ContractsConf where
  def = ContractsConf
    { railgunProxy = Nothing
    }

instance Default UrlConfig where
  def = UrlConfig
    { vaultUrl = "https://vault.blockapps.net:8093/strato/v2.3"
    , fileServerUrl = ""
    , notificationServerUrl = ""
    }

instance Default NetworkConf where
  def = NetworkConf
    { network = "upquark"
    , networkID = -1  -- will be computed from network name
    , txSizeLimit = 2097152  -- 2 MiB
    , gasLimit = 1000000
    , blockPeriodMs = 1000   -- minimum delay between blocks
    , roundPeriodS = 120     -- max seconds one validator is proposer
    }

instance Default EthConf where
  def = EthConf
    { sqlConfig = def
    , cirrusConfig = def { database = "cirrus" }
    , redisBlockDBConfig = def
    , kafkaConfig = def
    , levelDBConfig = def
    , quarryConfig = def
    , discoveryConfig = def
    , p2pConfig = def
    , apiConfig = def
    , contractsConfig = Nothing
    , urlConfig = def
    , networkConfig = def
    , debugConfig = def
    }
