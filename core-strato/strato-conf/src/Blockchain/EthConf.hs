{-# LANGUAGE DeriveGeneric    #-}
{-# LANGUAGE FlexibleContexts #-}

module Blockchain.EthConf (
      EthConf(..),
      DiscoveryConf(..),
      SqlConf(..), postgreSQLConnectionString,
      KafkaConf(..), runKafkaConfigured, lookupConsumerGroup, mkConfiguredKafkaState,
      RedisBlockDBConf(..), lookupRedisBlockDBConfig,
      LevelDBConf(..),
      QuarryConf(..),
      BlockConf(..),
      EthUniqueId(..),
      PrivKey(..),
      ethConf,
      connStr,
    ) where

import           Control.Monad.Except       (ExceptT (..))
import           Control.Monad.Trans.State
import qualified Data.ByteString            as B
import qualified Data.ByteString.Char8      as B8
import           Data.Ratio                 ((%))
import           Data.String
import           Data.Yaml
import           Database.PostgreSQL.Simple (ConnectInfo (..))
import qualified Database.PostgreSQL.Simple as PS (postgreSQLConnectionString)
import qualified Database.Redis             as Redis
import           Network.Kafka
import qualified Network.Kafka.Protocol     as KP
import           System.IO.Unsafe

import           GHC.Generics

import           Blockchain.PrivateKeyConf

data EthConf =
    EthConf {
        ethUniqueId        :: EthUniqueId,
        privKey            :: PrivKey,
        sqlConfig          :: SqlConf,
        redisBlockDBConfig :: RedisBlockDBConf,
        kafkaConfig        :: KafkaConf,
        levelDBConfig      :: LevelDBConf,
        quarryConfig       :: QuarryConf,
        blockConfig        :: BlockConf,
        discoveryConfig    :: DiscoveryConf
    } deriving (Generic)

instance FromJSON EthConf
instance ToJSON EthConf

data DiscoveryConf =
    DiscoveryConf {
        discoveryPort     :: Int,
        minAvailablePeers :: Int
    } deriving (Generic)

instance FromJSON DiscoveryConf
instance ToJSON DiscoveryConf

data SqlConf =
    SqlConf {
        user     :: String,
        password :: String,
        host     :: String,
        port     :: Int,
        database :: String,
        poolsize :: Int
    } deriving (Generic)

instance FromJSON SqlConf
instance ToJSON SqlConf

data KafkaConf =
    KafkaConf {
        kafkaHost :: String,
        kafkaPort :: Int
    } deriving (Generic)

instance FromJSON KafkaConf
instance ToJSON KafkaConf

data RedisBlockDBConf =
    RedisBlockDBConf {
        redisHost           :: String,
        redisPort           :: Int,
        redisAuth           :: Maybe String,
        redisDBNumber       :: Integer,
        redisMaxConnections :: Int,
        redisMaxIdleTime    :: Integer
    } deriving (Eq, Read, Show, Generic)

instance FromJSON RedisBlockDBConf
instance ToJSON   RedisBlockDBConf

data EthUniqueId =
    EthUniqueId {
        peerId      :: String,
        genesisHash :: String,
        networkId   :: Int
    } deriving (Generic)

instance FromJSON EthUniqueId
instance ToJSON EthUniqueId

postgreSQLConnectionString :: SqlConf -> B.ByteString
postgreSQLConnectionString sqlc =
  PS.postgreSQLConnectionString ConnectInfo {
    connectHost     = host sqlc,
    connectPort     = fromIntegral $ port sqlc,
    connectUser     = user sqlc,
    connectPassword = password sqlc,
    connectDatabase = database sqlc
  }

data LevelDBConf =
    LevelDBConf {
        table :: String,
        path  :: String
    } deriving (Generic)

instance FromJSON LevelDBConf
instance ToJSON LevelDBConf

data QuarryConf =
    QuarryConf {
        coinbaseAddress :: String,
        lazyBlocks      :: Bool
    } deriving (Generic)

instance FromJSON QuarryConf
instance ToJSON QuarryConf

data BlockConf =
    BlockConf {
        blockTime          :: Integer,
        minBlockDifficulty :: Integer
    } deriving (Generic)

instance FromJSON BlockConf
instance ToJSON BlockConf

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
mkConfiguredKafkaState cid = mkKafkaState cid (kh, kp)
    where k = kafkaConfig ethConf
          kh = fromString $ kafkaHost k
          kp = fromIntegral $ kafkaPort k

lookupConsumerGroup :: KafkaClientId -> KP.ConsumerGroup
lookupConsumerGroup kcid = KP.ConsumerGroup . KP.KString $ kStr `B8.append` nodeId
    where kStr   = KP._kString kcid
          nodeId = B8.pack $ "_" ++ peerId (ethUniqueId ethConf)

lookupRedisBlockDBConfig :: Redis.ConnectInfo
lookupRedisBlockDBConfig = let r = redisBlockDBConfig ethConf in
    Redis.defaultConnectInfo {
        Redis.connectHost           = redisHost r,
        Redis.connectPort           = Redis.PortNumber $ fromIntegral (redisPort r),
        Redis.connectAuth           = B8.pack <$> redisAuth r,
        Redis.connectDatabase       = redisDBNumber r,
        Redis.connectMaxConnections = redisMaxConnections r,
        Redis.connectMaxIdleTime    = fromRational (redisMaxIdleTime r % 1)
    }
