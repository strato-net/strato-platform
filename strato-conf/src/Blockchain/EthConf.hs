{-# LANGUAGE DeriveGeneric #-}

module Blockchain.EthConf ( 
      EthConf(..),
      DiscoveryConf(..),
      SqlConf(..), postgreSQLConnectionString,
      KafkaConf(..), runKafkaConfigured,
      LevelDBConf(..),
      QuarryConf(..),
      BlockConf(..),
      EthUniqueId(..),
      GeneralConf(..),
      PrivKey(..),
      ethConf,
      connStr,
      connStr'
    ) where

import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as B8
import Data.Yaml
import Database.PostgreSQL.Simple (ConnectInfo(..))
import qualified Database.PostgreSQL.Simple as PS (postgreSQLConnectionString)
import GHC.Generics
import System.IO.Unsafe

import Data.String
import Network.Kafka
import qualified Network.Kafka.Protocol as KP

import Blockchain.PrivateKeyConf

data EthConf = 
    EthConf {
      ethUniqueId::EthUniqueId,
      privKey::PrivKey,
      sqlConfig::SqlConf,
      kafkaConfig::KafkaConf,
      levelDBConfig::LevelDBConf,
      quarryConfig::QuarryConf,
      blockConfig::BlockConf,
      discoveryConfig::DiscoveryConf,
      generalConfig::GeneralConf
    } deriving (Generic)

instance FromJSON EthConf
instance ToJSON EthConf

data DiscoveryConf =
  DiscoveryConf {
    discoveryPort::Int,
    minAvailablePeers::Int
    } deriving (Generic)

instance FromJSON DiscoveryConf
instance ToJSON DiscoveryConf


data GeneralConf =
  GeneralConf {
    fastECRecover::Bool
    } deriving (Generic)

instance FromJSON GeneralConf
instance ToJSON GeneralConf


--type EthRoot = FilePath

data SqlConf = SqlConf
               { user :: String
               , password :: String
               , host :: String
               , port :: Int
               , database :: String
               , poolsize :: Int
               } deriving (Generic)

instance FromJSON SqlConf
instance ToJSON SqlConf

data KafkaConf = KafkaConf {
  kafkaHost :: String,
  kafkaPort :: Int
  } deriving (Generic)

instance FromJSON KafkaConf
instance ToJSON KafkaConf

data EthUniqueId = EthUniqueId
               { peerId :: String
               , genesisHash :: String
               , networkId :: Int
               } deriving (Generic)

instance FromJSON EthUniqueId
instance ToJSON EthUniqueId

postgreSQLConnectionString :: SqlConf -> B.ByteString
postgreSQLConnectionString sqlc =
  PS.postgreSQLConnectionString $ ConnectInfo {
    connectHost = host sqlc,
    connectPort = fromIntegral $ port sqlc,
    connectUser = user sqlc,
    connectPassword = password sqlc,
    connectDatabase = database sqlc
  }

data LevelDBConf = LevelDBConf 
                 { table :: String
                 , path  :: String
                 } deriving (Generic)

instance FromJSON LevelDBConf
instance ToJSON LevelDBConf

data QuarryConf = QuarryConf {
  coinbaseAddress :: String,
  lazyBlocks :: Bool
  } deriving (Generic)

instance FromJSON QuarryConf
instance ToJSON QuarryConf

data BlockConf = BlockConf {
  blockTime :: Integer,
  minBlockDifficulty :: Integer
  } deriving (Generic)

instance FromJSON BlockConf
instance ToJSON BlockConf

{- CONFIG: first change, make this local -} 

ethConf::EthConf
ethConf = unsafePerformIO $ do
            contents <- B.readFile $ ".ethereumH/ethconf.yaml"                   
            return $ (either error id . decodeEither) contents


{- CONFIG: clobber connection string -}

connStr::B.ByteString
connStr = postgreSQLConnectionString . sqlConfig $ ethConf

connStr'::B.ByteString
connStr' = postgreSQLConnectionString . sqlConfig $ ethConf

runKafkaConfigured :: KafkaClientId -> Kafka a -> IO (Either KafkaClientError a)
runKafkaConfigured name = runKafka (mkKafkaState name (kh, kp))
  where k = kafkaConfig ethConf
        kh = fromString $ kafkaHost k
        kp = fromIntegral $ kafkaPort k
