{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE RecordWildCards #-}

module Blockchain.Init.EthConf (genEthConf) where

import Blockchain.EthConf
import Blockchain.Init.Options
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Options (flags_network, flags_txSizeLimit, flags_gasLimit, computeNetworkID)
import Control.Concurrent
import Data.Default
import Network.HTTP.Types.Status
import Servant.Client
import Strato.Auth.Client (AuthEnv, newAuthEnv, runWithAuth)
import qualified Strato.Strato23.API.Types as VC
import Strato.Strato23.Client
import System.Info (os)
import Text.ShortDescription

-- | Get the API IP address, using mode-appropriate default for Docker
getApiIPAddress :: String
getApiIPAddress
  | flags_apiIPAddress /= "127.0.0.1" = flags_apiIPAddress  -- User provided explicit value
  | flags_dockerMode == "allDocker" = "0.0.0.0"             -- Bind to all interfaces in container
  | os == "linux" = "172.17.0.1"                            -- Linux Docker bridge (local mode)
  | otherwise = "host.docker.internal"                      -- macOS/Windows Docker

-- | Get the Kafka host, using mode-appropriate default
getKafkaHost :: String
getKafkaHost
  | flags_kafkahost /= "localhost" = flags_kafkahost        -- User provided explicit value
  | flags_dockerMode == "allDocker" = "kafka"               -- Service name in Docker network
  | otherwise = "localhost"                                 -- Local development

-- | Get Railgun contract addresses for known networks
-- Returns Nothing for networks where contracts haven't been deployed yet
getRailgunProxyForNetwork :: String -> Maybe Address
getRailgunProxyForNetwork network = case network of
  "helium"  -> Just 0x84340ae5a421a216339d74173aa39408aab61d74
  "upquark" -> Nothing  -- TODO: Set when deployed
  "lithium" -> Nothing  -- TODO: Set when deployed
  _         -> Nothing

-- | Runtime config that overrides defaults with command-line flags
runtimeConfig :: EthConf
runtimeConfig = def
  { sqlConfig = def { host = "postgres" }
  , cirrusConfig = def { host = "postgres", database = "cirrus" }
  , redisBlockDBConfig = def
      { redisHost = flags_redisHost
      , redisPort = flags_redisPort
      , redisDBNumber = flags_redisDBNumber
      }
  , kafkaConfig = def { kafkaHost = "kafka" }
  , discoveryConfig = def { minAvailablePeers = flags_minPeers }
  , p2pConfig = def
      { maxConnections = flags_maxConn
      , connectionTimeout = flags_connectionTimeout
      , maxReturnedHeaders = flags_maxReturnedHeaders
      , averageTxsPerBlock = flags_averageTxsPerBlock
      , maxHeadersTxsLens = flags_maxHeadersTxsLens
      }
  , apiConfig = def
      { ipAddress = getApiIPAddress
      , httpPort = flags_httpPort
      }
  , contractsConfig = getRailgunProxyForNetwork flags_network >>= \addr ->
      Just ContractsConf { railgunProxy = Just addr }
  , debugConfig = def { svmTrace = flags_svmTrace }
  }

getNodeKey :: IO (VC.PublicKey, Address)
getNodeKey = do
  env <- newAuthEnv flags_vaultUrl
  ak <- waitOnVault env $ runWithAuth env (getKey Nothing Nothing)
  return (VC.unPubKey ak, VC.unAddress ak)

waitOnVault :: AuthEnv -> IO (Either ClientError VC.AddressAndKey) -> IO VC.AddressAndKey
waitOnVault env request = do
  res <- request
  case res of
    Left (FailureResponse _ (Response (Status code _) _ _ body)) -> case code of
      503 -> do
        putStrLn "vault password is not set. I'll keep trying until it is set"
        threadDelay 2000000
        waitOnVault env request
      400 ->
        if flags_generateKey
          then do
            putStrLn "nodekey does not exist - I'm going to create one"
            waitOnVault env $ runWithAuth env (postKey Nothing)
          else do
            putStrLn "nodekey does not exist - I'm going to wait until you insert it manually"
            threadDelay 5000000
            waitOnVault env request
      _ -> do
        putStrLn $ "unexpected error thrown by vault: " ++ show body
        putStrLn "will keep retrying anyway"
        threadDelay 5000000
        waitOnVault env request
    Left err -> do
      putStrLn $ "unexpected servant error: " ++ show err
      putStrLn "will keep retrying anyway"
      threadDelay 5000000
      waitOnVault env request
    Right val -> return val

genEthConf :: IO EthConf
genEthConf = do
  pgPass <- filter (/= '\n') <$> readFile "secrets/postgres_password"

  (pub, _addr) <- getNodeKey
  putStrLn $ "  ✓ Node key: " ++ shortDescription pub

  return runtimeConfig
    { sqlConfig = (sqlConfig runtimeConfig)
        { user = flags_pguser
        , host = flags_pghost
        , password = pgPass
        }
    , cirrusConfig = (cirrusConfig runtimeConfig)
        { user = flags_pguser
        , host = flags_pghost
        , password = pgPass
        }
    , kafkaConfig = (kafkaConfig runtimeConfig) { kafkaHost = getKafkaHost }
    , levelDBConfig = def
        { cacheSize = flags_ldbCacheSize
        , blockSize = flags_ldbBlockSize
        }
    , quarryConfig = def
        { lazyBlocks = flags_lazyblocks
        , maxTxsPerBlock = flags_maxTxsPerBlock
        , mempoolLivenessCutoff = flags_mempoolLivenessCutoff
        }
    , urlConfig = def
        { vaultUrl = flags_vaultUrl
        , fileServerUrl = deriveFileServerUrl flags_fileServerUrl flags_network
        , notificationServerUrl = flags_notificationServerUrl
        , repoUrl = flags_repoUrl
        }
    , networkConfig = def
        { network = flags_network
        , networkID = computeNetworkID
        , txSizeLimit = flags_txSizeLimit
        , gasLimit = flags_gasLimit
        , blockPeriodMs = flags_blockstanbul_block_period_ms
        , roundPeriodS = flags_blockstanbul_round_period_s
        }
    }

-- | Derive file server URL from network if not explicitly provided
deriveFileServerUrl :: String -> String -> String
deriveFileServerUrl "" "mercata-hydrogen" = "https://fileserver.mercata-testnet2.blockapps.net/highway"
deriveFileServerUrl "" network
  | take 6 network == "helium" = "https://fileserver.mercata.blockapps.net/highway"
deriveFileServerUrl "" "upquark" = "https://fileserver.mercata.blockapps.net/highway"
deriveFileServerUrl "" "mercata" = "https://fileserver.mercata.blockapps.net/highway"
deriveFileServerUrl "" "uranium" = "https://fileserver.mercata.blockapps.net/highway"
deriveFileServerUrl "" "lithium" = "https://fileserver.mercata.blockapps.net/highway"
deriveFileServerUrl "" _ = ""  -- Unknown networks get empty string
deriveFileServerUrl url _ = url  -- Explicit URL takes precedence
