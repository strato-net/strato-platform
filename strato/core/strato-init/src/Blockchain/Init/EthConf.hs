{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE RecordWildCards #-}
module Blockchain.Init.EthConf (genEthConf) where

import           Control.Concurrent
import qualified Data.ByteString.Base16             as B16
import qualified Data.ByteString.Char8              as C8
import           Data.Maybe
import qualified Data.Text                          as T
import           Network.HTTP.Client                (newManager, defaultManagerSettings)
import           Network.HTTP.Types.Status
import           Servant.Client
import           System.Entropy
import           Text.Format

import           Blockchain.EthConf
import           Blockchain.Init.Options
import           Blockchain.Strato.Model.Address
import           Strato.Strato23.Client
import qualified Strato.Strato23.API                as VC



defaultSqlConfig :: SqlConf
defaultSqlConfig =
    SqlConf {
      user = "postgres",
      password = "api",
      host = "postgres",
      port = 5432,
      database = "eth",
      poolsize = 10
    }

defaultKafkaConfig :: KafkaConf
defaultKafkaConfig = KafkaConf {
  kafkaHost = "kafka",
  kafkaPort = 9092
  }

defaultLevelDBConfig :: LevelDBConf
defaultLevelDBConfig =
    LevelDBConf {
      table = "",
      path = ""
    }

defaultBlockConfig :: BlockConf
defaultBlockConfig =
    BlockConf {
      blockTime = 13,
      minBlockDifficulty = 131072
    }

defaultEthUniqueId :: EthUniqueId
defaultEthUniqueId =
    EthUniqueId {
      peerId = "",
      genesisHash = "",
      networkId = 0
    }

defaultQuarryConfig  ::  QuarryConf
defaultQuarryConfig =
    QuarryConf {
      coinbaseAddress = "ab",
      lazyBlocks = False
    }


defaultDiscoveryConfig  ::  DiscoveryConf
defaultDiscoveryConfig =
    DiscoveryConf {
      discoveryPort=30303,
      minAvailablePeers=flags_minPeers
    }

defaultRedisBlockDBConfig  ::  RedisBlockDBConf
defaultRedisBlockDBConfig = RedisBlockDBConf {
    redisHost           = flags_redisHost,
    redisPort           = flags_redisPort,
    redisAuth           = Nothing,
    redisDBNumber       = flags_redisDBNumber,
    redisMaxConnections = 10,
    redisMaxIdleTime    = 30
    }

defaultConfig :: EthConf
defaultConfig =
    EthConf {
      ethUniqueId        = defaultEthUniqueId,
      sqlConfig          = defaultSqlConfig,
      redisBlockDBConfig = defaultRedisBlockDBConfig,
      levelDBConfig      = defaultLevelDBConfig,
      kafkaConfig        = defaultKafkaConfig,
      blockConfig        = defaultBlockConfig,
      quarryConfig       = defaultQuarryConfig,
      discoveryConfig    = defaultDiscoveryConfig
    }


getNodeKey :: IO (VC.PublicKey, Address)
getNodeKey = do
  mgr <- newManager defaultManagerSettings
  vaultWrapperUrl <- parseBaseUrl flags_vaultWrapperUrl 
  let clientEnv = mkClientEnv mgr vaultWrapperUrl
  putStrLn "asking vault-wrapper for the node's key, or to create one, if it does not exist"
  ak <- waitOnVault clientEnv $ runClientM (getKey (Just $ T.pack "nodekey") Nothing) clientEnv
  return (VC.unPubKey ak, VC.unAddress ak)

waitOnVault :: ClientEnv -> IO (Either ClientError VC.AddressAndKey) -> IO VC.AddressAndKey
waitOnVault clientEnv request = do
  res <- request
  case res of
    Left (FailureResponse _ (Response (Status code _) _ _ body)) -> case code of
      503 -> do -- 503 is thrown when the password is not set
        putStrLn "vault password is not set. I'll keep trying until it is set"
        threadDelay 2000000 -- 2 seconds
        waitOnVault clientEnv request
      400 -> -- 400 is thrown when the key does not exist
        if flags_generateKey then do 
          putStrLn "nodekey does not exist -  I'm going to create one"
          waitOnVault clientEnv $ runClientM (postKey $ Just $ T.pack "nodekey") clientEnv
        else do
          putStrLn "nodekey does not exist - I'm going to wait until you insert it manually"
          threadDelay 5000000 -- 5 seconds
          waitOnVault clientEnv request
      _ -> do
        putStrLn $ "unexpected error thrown by vault-wrapper: " ++ show body
        putStrLn "will keep retrying anyway"
        threadDelay 5000000 -- 5 seconds
        waitOnVault clientEnv request
    Left err -> do 
      putStrLn $ "unexpected servant error: " ++ show err
      putStrLn "will keep retrying anyway"
      threadDelay 5000000 -- 5 seconds
      waitOnVault clientEnv request
    Right val -> return val


genEthConf :: IO EthConf
genEthConf = do
  maybePGuser <- case flags_pguser of
         "" -> do putStrLn "using default postgres user: postgres"
                  return (Just "postgres")
         user' -> return (Just user')

  maybePGhost <- case flags_pghost of
         "" -> do putStrLn "using default postgres host: localhost"
                  return (Just "localhost")
         host' -> return (Just host')

  maybePGpass <- case flags_password of
         ""   -> error "specify password for postgres user: "
         pass -> return (Just pass)

  kafkaHostFlag <- case flags_kafkahost of
         "" -> do putStrLn "using default kafka host: localhost"
                  return "localhost"
         host' -> return host'


  (pub, addr) <- getNodeKey 
  putStrLn $ "the node's public key: " ++ format pub
  putStrLn $ "the node's address: " ++ format addr


  bytes <- getEntropy 20
  let user'' =  case maybePGuser of
                    Nothing  -> "postgres"
                    Just ""  -> "postgres"
                    Just usr -> usr
  let cfg = defaultConfig {
                    sqlConfig = defaultSqlConfig {
                        user     = user'',
                        host     = fromMaybe "localhost" maybePGhost,
                        password = fromMaybe "" maybePGpass
                    },
                    blockConfig = defaultBlockConfig {
                        blockTime          = flags_blockTime,
                        minBlockDifficulty = flags_minBlockDifficulty
                    },
                    quarryConfig = defaultQuarryConfig {
                        lazyBlocks = flags_lazyblocks
                    }
                }
  let uniqueString = C8.unpack . B16.encode $ bytes
      pgCfg = sqlConfig cfg
      db = database pgCfg
      db' = db ++ "_" ++ uniqueString
      pgCfg'' = pgCfg { database = db' }
      kafkaCfg = defaultKafkaConfig { kafkaHost = kafkaHostFlag }


  return cfg {
                   sqlConfig = pgCfg'',
                   kafkaConfig = kafkaCfg,
                   ethUniqueId = defaultEthUniqueId {
                     peerId = uniqueString
                   },
                   quarryConfig = (quarryConfig cfg) {
                    coinbaseAddress = formatAddressWithoutColor addr
                   }
                 }
