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
import Servant.Client (BaseUrl, parseBaseUrl)

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
    blockConfig :: BlockConf,
    discoveryConfig :: DiscoveryConf,
    apiConfig :: ApiConfig,
    contractsConfig :: Maybe ContractsConf,
    urlConfig :: UrlConfig
  }
  deriving (Show, Eq, Generic)

instance FromJSON EthConf where
  parseJSON = withObject "EthConf" $ \v -> EthConf
    <$> v .: "sqlConfig"
    <*> v .: "cirrusConfig"
    <*> v .: "redisBlockDBConfig"
    <*> v .: "kafkaConfig"
    <*> v .: "levelDBConfig"
    <*> v .: "quarryConfig"
    <*> v .: "blockConfig"
    <*> v .: "discoveryConfig"
    <*> v .: "apiConfig"
    <*> v .:? "contractsConfig"
    <*> v .:? "urlConfig" .!= def

instance ToJSON EthConf where
  toJSON = Aeson.genericToJSON Aeson.defaultOptions { Aeson.omitNothingFields = True }
  toEncoding = Aeson.genericToEncoding Aeson.defaultOptions { Aeson.omitNothingFields = True }

data ApiConfig = ApiConfig
  { ipAddress :: String
  } deriving (Show, Eq, Generic, FromJSON, ToJSON)

data DiscoveryConf = DiscoveryConf
  { discoveryPort :: Int,
    minAvailablePeers :: Int
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
    path :: String
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data QuarryConf = QuarryConf
  { lazyBlocks :: Bool
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data BlockConf = BlockConf
  { blockTime :: Integer,
    minBlockDifficulty :: Integer
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data ContractsConf = ContractsConf
  { railgunProxy :: Maybe Address  -- ^ RailgunSmartWallet proxy contract address
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data UrlConfig = UrlConfig
  { vaultProxyUrl :: BaseUrl
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
    }

instance Default QuarryConf where
  def = QuarryConf
    { lazyBlocks = False
    }

instance Default BlockConf where
  def = BlockConf
    { blockTime = 13
    , minBlockDifficulty = 131072
    }

instance Default DiscoveryConf where
  def = DiscoveryConf
    { discoveryPort = 30303
    , minAvailablePeers = 0
    }

instance Default ApiConfig where
  def = ApiConfig
    { ipAddress = "127.0.0.1"
    }

instance Default ContractsConf where
  def = ContractsConf
    { railgunProxy = Nothing
    }

instance Default UrlConfig where
  def = UrlConfig
    { vaultProxyUrl = case parseBaseUrl "http://localhost:8013/strato/v2.3" of
        Just url -> url
        Nothing -> error "Invalid default vaultProxyUrl"
    }

instance Default EthConf where
  def = EthConf
    { sqlConfig = def
    , cirrusConfig = def { database = "cirrus" }
    , redisBlockDBConfig = def
    , kafkaConfig = def
    , levelDBConfig = def
    , quarryConfig = def
    , blockConfig = def
    , discoveryConfig = def
    , apiConfig = def
    , contractsConfig = Nothing
    , urlConfig = def
    }
