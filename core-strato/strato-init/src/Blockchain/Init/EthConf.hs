{-# LANGUAGE BangPatterns #-}
module Blockchain.Init.EthConf (genEthConf) where

-- import Control.Concurrent
import Control.Monad
import qualified Data.ByteString.Base16             as B16
import qualified Data.ByteString.Base64             as B64
import qualified Data.ByteString.Char8              as C8
import Data.Coerce
import Data.Maybe
import Data.Either.Extra
import System.Entropy
import System.Environment

import qualified Data.Text as T
import Servant.Client
import Network.HTTP.Client (newManager, defaultManagerSettings)
--import Network.HTTP.Types.Status
import Strato.Strato23.Client
--import Strato.Strato23.API.Types
--import qualified Crypto.Secp256k1 as Crypto

import Blockchain.EthConf
import Blockchain.Init.Options
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord



-- TODO: Remove after migration testing
import Strato.Strato23.MigrateNodeKey


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

defaultPrivKey :: PrivKey
defaultPrivKey = PrivKey 0

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
      privKey            = defaultPrivKey,
      sqlConfig          = defaultSqlConfig,
      redisBlockDBConfig = defaultRedisBlockDBConfig,
      levelDBConfig      = defaultLevelDBConfig,
      kafkaConfig        = defaultKafkaConfig,
      blockConfig        = defaultBlockConfig,
      quarryConfig       = defaultQuarryConfig,
      discoveryConfig    = defaultDiscoveryConfig
    }



--getNodeKey :: ClientEnv -> IO Crypto.PubKey
--getNodeKey clientEnv = do
--  pIsSet <- runClientM (postPassword $ T.pack "1234") clientEnv
--  case pIsSet of 
--    Left err -> error $ "could not set vault-wrapper password: " ++ (show err)
--    Right _ -> do 
--      ePub <- runClientM (postKey $ T.pack "_nodekey") clientEnv 
--      case ePub of 
--        Left (FailureResponse resp) -> do
--          if (statusCode $ responseStatusCode resp) == 503 then do
--            putStrLn $ "vault-wrapper password is not set, cannot create nodekey"
--            threadDelay $ 50000
--            getNodeKey clientEnv
--          else
--            error $ "some unexpected error creating nodekey:" ++ (show resp)
--        Left err -> error $ "even more odd an error creating nodekey: " ++ (show err)
--        Right pk -> return $ unPubKey pk


-- TODO: maybe this should be a generic util function somewhere else
{- waitOnVault :: (Show a) => IO (Either a b) -> IO b
waitOnVault action = do
  putStrLn "asking vault-wrapper for the node address (or to create a new key)"
  res <- action
  case res of
    Left err -> do 
      putStrLn $ "failed to get node address from vault-wrapper... got this error: " ++ show err
      threadDelay 2000000 -- 2 seconds
      waitOnVault action
    Right val -> return val  
 -}

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

  bytes <- getEntropy 20



  mgr <- newManager defaultManagerSettings
  vaultWrapperUrl <- parseBaseUrl "http://vault-wrapper:8000/strato/v2.3" 
  let clientEnv = ClientEnv mgr vaultWrapperUrl Nothing

  -- temp
  pIsSet <- runClientM (postPassword $ T.pack "123") clientEnv
  pub <- case pIsSet of 
    Left err -> error $ "could not set vault-wrapper password: " ++ (show err)
    Right _ -> do 
      key <- fromMaybe (error "NODEKEY not set") <$> lookupEnv "NODEKEY"
      migrateNodeKey key "123"

--  pub <- getNodeKey clientEnv

  putStrLn $ "DEBUG/vault's node public key: " ++ (show pub)

  -- TODO: what to do with the pubkey, privkey in ethconf file?
 

  --       If blockstanbulPrivateKey is set, run migration code to add it to vault-wrapper
  --       manually. Then we don't need it anymore after that. If not, make the key.
  
  myPrivKey <-
    if flags_singlePrivateKey
      then do 
        !skey <- fromMaybe (error "NODEKEY not set") <$> lookupEnv "NODEKEY"
        let !bs = fromRight (error $ "Invalid base64 NODEKEY: " ++ show skey) . B64.decode . C8.pack $ skey
        when (C8.length bs /= 32) $ error $ "The private key decoded from NODEKEY is the wrong length: NODEKEY: " ++ show skey ++ ", decoded: '" ++ C8.unpack (B16.encode bs) ++ "'"
        return . PrivKey . fromIntegral $ bytesToWord256 bs
      else generatePrivKey
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
                   privKey = myPrivKey,
                   sqlConfig = pgCfg'',
                   kafkaConfig = kafkaCfg,
                   ethUniqueId = defaultEthUniqueId {
                     peerId = uniqueString
                   },
                   quarryConfig = (quarryConfig cfg) {
                    coinbaseAddress = formatAddressWithoutColor . fromInteger $ coerce myPrivKey
                   }
                 }
