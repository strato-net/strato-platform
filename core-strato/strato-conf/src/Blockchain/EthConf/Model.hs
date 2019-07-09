module Blockchain.EthConf.Model where
-- These are the aspects EthConf that don't require unsafePerformIO

import           Blockchain.ECIES
import           Crypto.PubKey.ECC.DH
import           Crypto.Random
import           Data.Bifunctor
import qualified Data.ByteString            as B
import qualified Data.ByteString.Char8      as C8
import           Data.Ratio
import           Data.Yaml
import qualified Database.PostgreSQL.Simple as PS (ConnectInfo(..), postgreSQLConnectionString)
import qualified Database.Redis             as Redis
import           GHC.Generics
import           Numeric

postgreSQLConnectionString :: SqlConf -> B.ByteString
postgreSQLConnectionString sqlc =
  PS.postgreSQLConnectionString PS.ConnectInfo {
    PS.connectHost     = host sqlc,
    PS.connectPort     = fromIntegral $ port sqlc,
    PS.connectUser     = user sqlc,
    PS.connectPassword = password sqlc,
    PS.connectDatabase = database sqlc
  }

redisConnection :: RedisBlockDBConf -> Redis.ConnectInfo
redisConnection r =
    Redis.defaultConnectInfo {
        Redis.connectHost           = redisHost r,
        Redis.connectPort           = Redis.PortNumber $ fromIntegral (redisPort r),
        Redis.connectAuth           = C8.pack <$> redisAuth r,
        Redis.connectDatabase       = redisDBNumber r,
        Redis.connectMaxConnections = redisMaxConnections r,
        Redis.connectMaxIdleTime    = fromRational (redisMaxIdleTime r % 1)
    }

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
    } deriving (Show, Eq, Generic, FromJSON, ToJSON)

data DiscoveryConf =
    DiscoveryConf {
        discoveryPort     :: Int,
        minAvailablePeers :: Int
    } deriving (Show, Eq, Generic, FromJSON, ToJSON)

data SqlConf =
    SqlConf {
        user     :: String,
        password :: String,
        host     :: String,
        port     :: Int,
        database :: String,
        poolsize :: Int
    } deriving (Show, Eq, Generic, FromJSON, ToJSON)

data KafkaConf =
    KafkaConf {
        kafkaHost :: String,
        kafkaPort :: Int
    } deriving (Show, Eq, Generic, FromJSON, ToJSON)

data RedisBlockDBConf =
    RedisBlockDBConf {
        redisHost           :: String,
        redisPort           :: Int,
        redisAuth           :: Maybe String,
        redisDBNumber       :: Integer,
        redisMaxConnections :: Int,
        redisMaxIdleTime    :: Integer
    } deriving (Show, Eq, Generic, FromJSON, ToJSON)

data EthUniqueId =
    EthUniqueId {
        peerId      :: String,
        genesisHash :: String,
        networkId   :: Int
    } deriving (Show, Eq, Generic, FromJSON, ToJSON)

data LevelDBConf =
    LevelDBConf {
        table :: String,
        path  :: String
    } deriving (Show, Eq, Generic, FromJSON, ToJSON)

data QuarryConf =
    QuarryConf {
        coinbaseAddress :: String,
        lazyBlocks      :: Bool
    } deriving (Show, Eq, Generic, FromJSON, ToJSON)

data BlockConf =
    BlockConf {
        blockTime          :: Integer,
        minBlockDifficulty :: Integer
    } deriving (Show, Eq, Generic, FromJSON, ToJSON)

newtype PrivKey = PrivKey { unPrivKey :: PrivateNumber } deriving (Eq, Generic)

instance Read PrivKey where
  readsPrec _ s = map (first PrivKey) $ readHex s

instance Show PrivKey where
  show = flip showHex "" . unPrivKey

instance ToJSON PrivKey where
  toJSON = toJSON . show

instance FromJSON PrivKey where
  parseJSON v = read <$> parseJSON v

generatePrivKey :: IO PrivKey
generatePrivKey = do
  entropyPool <- createEntropyPool
  let g = cprgCreate entropyPool :: SystemRNG
  return . PrivKey . fst $ generatePrivate g theCurve
