{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Blockchain.EthConf.Model where

-- These are the aspects EthConf that don't require unsafePerformIO

import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import Control.Applicative ((<|>))
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
    streamingConfig :: StreamingConf,
    levelDBConfig :: LevelDBConf,
    quarryConfig :: QuarryConf,
    discoveryConfig :: DiscoveryConf,
    p2pConfig :: P2PConf,
    apiConfig :: ApiConfig,
    contractsConfig :: ContractsConf,
    urlConfig :: UrlConfig,
    networkConfig :: NetworkConf,
    debugConfig :: DebugConfig,
    vmConfig :: VmConf
  }
  deriving (Show, Eq, Generic)

-- Backward compatibility alias
kafkaConfig :: EthConf -> StreamingConf
kafkaConfig = streamingConfig
{-# DEPRECATED kafkaConfig "Use streamingConfig instead" #-}

instance FromJSON EthConf where
  parseJSON = withObject "EthConf" $ \v -> EthConf
    <$> v .: "sqlConfig"
    <*> v .: "cirrusConfig"
    <*> v .: "redisBlockDBConfig"
    <*> (v .:? "streamingConfig" .!= def <|> v .: "kafkaConfig")
    <*> v .:? "levelDBConfig" .!= def
    <*> v .:? "quarryConfig" .!= def
    <*> v .: "discoveryConfig"
    <*> v .:? "p2pConfig" .!= def
    <*> v .: "apiConfig"
    <*> v .:? "contractsConfig" .!= def
    <*> v .:? "urlConfig" .!= def
    <*> v .:? "networkConfig" .!= def
    <*> v .:? "debugConfig" .!= def
    <*> v .:? "vmConfig" .!= def

instance ToJSON EthConf where
  toJSON = Aeson.genericToJSON Aeson.defaultOptions { Aeson.omitNothingFields = True }
  toEncoding = Aeson.genericToEncoding Aeson.defaultOptions { Aeson.omitNothingFields = True }

data ApiConfig = ApiConfig
  { apiPort :: Int
  , apiListenAddress :: String
  } deriving (Show, Eq, Generic, ToJSON)

instance FromJSON ApiConfig where
  parseJSON = withObject "ApiConfig" $ \v -> ApiConfig
    <$> v .:? "apiPort" .!= 3000
    <*> v .:? "apiListenAddress" .!= "127.0.0.1"

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

data StreamingConf = StreamingConf
  { streamingHost :: String,
    streamingPort :: Int
  }
  deriving (Show, Eq, Generic, ToJSON)

-- Parse both old "kafkaHost/Port" and new "streamingHost/Port" field names
instance FromJSON StreamingConf where
  parseJSON = withObject "StreamingConf" $ \v -> StreamingConf
    <$> (v .:? "streamingHost" >>= maybe (v .:? "kafkaHost" .!= "localhost") pure)
    <*> (v .:? "streamingPort" >>= maybe (v .:? "kafkaPort" .!= 9092) pure)

-- Backward compatibility type alias
type KafkaConf = StreamingConf
{-# DEPRECATED KafkaConf "Use StreamingConf instead" #-}

-- Backward compatibility field accessors
kafkaHost :: StreamingConf -> String
kafkaHost = streamingHost
{-# DEPRECATED kafkaHost "Use streamingHost instead" #-}

kafkaPort :: StreamingConf -> Int
kafkaPort = streamingPort
{-# DEPRECATED kafkaPort "Use streamingPort instead" #-}

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
  , nativeTokenAddress :: Address  -- ^ ERC20 treated as native token (e.g. USDST)
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data UrlConfig = UrlConfig
  { nodeUrl :: String  -- Canonical external URL: http(s)://hostname[:port]
  , vaultUrl :: String
  -- | HTTP response timeout (seconds) for vault-wrapper signature / key
  -- requests. Default 12s; bump for high-concurrency scenarios where the
  -- vault HSM/HSM-proxy round-trip can spike under load. Set via
  -- --vaultTimeoutSec at strato-init time.
  , vaultTimeoutSec :: Int
  , fileServerUrl :: String
  , notificationServerUrl :: String
  , repoUrl :: String  -- Docker registry URL prefix for images
  , cookieRealm :: String  -- Domain for auth cookies (hostname, or parent domain for subdomain sharing)
  }
  deriving (Show, Eq, Generic, ToJSON)

-- Manual FromJSON so existing YAML configs without 'vaultTimeoutSec' continue
-- to parse (defaulting to 12s). Once all deployed configs include the field
-- this can be reverted to the derived instance.
instance FromJSON UrlConfig where
  parseJSON = withObject "UrlConfig" $ \v -> UrlConfig
    <$> v .:  "nodeUrl"
    <*> v .:  "vaultUrl"
    <*> v .:? "vaultTimeoutSec" .!= 12
    <*> v .:  "fileServerUrl"
    <*> v .:  "notificationServerUrl"
    <*> v .:  "repoUrl"
    <*> v .:? "cookieRealm" .!= "localhost"

data NetworkConf = NetworkConf
  { network :: String
  , networkID :: Integer
  , chainId :: Integer
  , httpPort :: Int
  , txSizeLimit :: Int
  , gasLimit :: Integer
  , blockPeriodMs :: Int
  , roundPeriodS :: Int
  -- | Block number from which stake-weighted proposer selection (BlockHeaderV3)
  -- is in force. 'Nothing' means "from genesis". Every node of a network must
  -- agree on this value.
  , stakingActivationBlock :: Maybe Integer
  }
  deriving (Show, Eq, Generic, ToJSON)

instance FromJSON NetworkConf where
  parseJSON = withObject "NetworkConf" $ \v -> do
    net <- v .:? "network" .!= "upquark"
    NetworkConf net
      <$> v .:? "networkID" .!= (-1)
      <*> v .:? "chainId" .!= computeChainId net
      <*> v .:? "httpPort" .!= 8081
      <*> v .:? "txSizeLimit" .!= 2097152
      <*> v .:? "gasLimit" .!= 1000000
      <*> v .:? "blockPeriodMs" .!= 1000
      <*> v .:? "roundPeriodS" .!= 3600
      <*> v .:? "stakingActivationBlock" .!= defaultStakingActivationBlock net

-- | Sentinel meaning "staking activation has not been scheduled yet" — used as
-- the default for networks that already exist so that a node upgrade never
-- switches consensus rules on its own. Set an explicit height in ethconf.yaml.
stakingNotScheduled :: Integer
stakingNotScheduled = 2 ^ (62 :: Int)

-- | Existing live networks default to "not scheduled"; anything else (fresh
-- dev/test networks) activates from genesis.
defaultStakingActivationBlock :: String -> Maybe Integer
defaultStakingActivationBlock net
  | net `elem` ["upquark", "lithium", "mercata", "mercata-hydrogen", "uranium"] = Just stakingNotScheduled
  | take 6 net == "helium" = Just 250000
  | otherwise = Nothing

-- | Is stake-weighted proposer selection in force at the given block number?
stakingActiveAt :: NetworkConf -> Integer -> Bool
stakingActiveAt conf height = maybe True (height >=) (stakingActivationBlock conf)

-- EIP-155 chain ID: keccak256(networkName), first 6 bytes (48 bits).
-- Fits in JS Number.MAX_SAFE_INTEGER with room for v = chainId * 2 + 35.
computeChainId :: String -> Integer
computeChainId networkName =
  let digest = keccak256ToByteString $ hash $ C8.pack networkName
  in foldl (\acc b -> acc * 256 + fromIntegral b) 0 (B.unpack $ B.take 6 digest)

data DebugConfig = DebugConfig
  { svmTrace :: Bool
  }
  deriving (Show, Eq, Generic, FromJSON, ToJSON)

data VmConf = VmConf
  { sqlDiff :: Bool
  , diffPublish :: Bool
  -- | Base URL of the node's ethereum-jsonrpc service, used by transaction
  -- simulation (same container). Default http://localhost:8545.
  , vmJsonRpcUrl :: String
  -- | Ceiling on concurrent in-flight simulations; excess are shed (503) so
  -- simulations can't starve block processing on the shared VM. Default 8.
  , simMaxConcurrent :: Int
  }
  deriving (Show, Eq, Generic, ToJSON)

-- Manual FromJSON so existing configs without the simulation fields (or the
-- whole vmConfig section) continue to parse, defaulting each field.
instance FromJSON VmConf where
  parseJSON = withObject "VmConf" $ \v -> VmConf
    <$> v .:? "sqlDiff" .!= True
    <*> v .:? "diffPublish" .!= True
    <*> v .:? "vmJsonRpcUrl" .!= "http://localhost:8545"
    <*> v .:? "simMaxConcurrent" .!= 8

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

instance Default StreamingConf where
  def = StreamingConf
    { streamingHost = "localhost"
    , streamingPort = 9092
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
    { apiPort = 3000
    , apiListenAddress = "127.0.0.1"
    }

instance Default DebugConfig where
  def = DebugConfig
    { svmTrace = False
    }

instance Default VmConf where
  def = VmConf
    { sqlDiff = True
    , diffPublish = True
    , vmJsonRpcUrl = "http://localhost:8545"
    , simMaxConcurrent = 8
    }

instance Default ContractsConf where
  def = ContractsConf
    { railgunProxy = Nothing
    , nativeTokenAddress = 0
    }

instance Default UrlConfig where
  def = UrlConfig
    { nodeUrl = "http://localhost:8081"
    , vaultUrl = "https://vault.blockapps.net:8093"
    , vaultTimeoutSec = 12
    , fileServerUrl = ""
    , notificationServerUrl = ""
    , repoUrl = ""
    , cookieRealm = "localhost"
    }

instance Default NetworkConf where
  def = NetworkConf
    { network = "upquark"
    , networkID = -1  -- will be computed from network name
    , chainId = computeChainId "upquark"
    , httpPort = 8081
    , txSizeLimit = 2097152  -- 2 MiB
    , gasLimit = 1000000
    , blockPeriodMs = 1000   -- minimum delay between blocks
    , roundPeriodS = 3600    -- backstop: seconds without progress before a forced round change
    , stakingActivationBlock = defaultStakingActivationBlock "upquark"
    }

instance Default EthConf where
  def = EthConf
    { sqlConfig = def
    , cirrusConfig = def { database = "cirrus" }
    , redisBlockDBConfig = def
    , streamingConfig = def
    , levelDBConfig = def
    , quarryConfig = def
    , discoveryConfig = def
    , p2pConfig = def
    , apiConfig = def
    , contractsConfig = def
    , urlConfig = def
    , networkConfig = def
    , debugConfig = def
    , vmConfig = def
    }
