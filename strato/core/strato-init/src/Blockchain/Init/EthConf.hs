{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE RecordWildCards #-}

module Blockchain.Init.EthConf (genEthConf) where

import Blockchain.EthConf
import Blockchain.Init.Options
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Options (flags_network)
import Control.Concurrent
import Data.Default
import Network.HTTP.Client (defaultManagerSettings, newManager)
import Network.HTTP.Types.Status
import Servant.Client
import qualified Strato.Strato23.API as VC
import Strato.Strato23.Client
import Text.Format

-- | Get Railgun contract addresses for known networks
-- Returns Nothing for networks where contracts haven't been deployed yet
getRailgunProxyForNetwork :: String -> Maybe Address
getRailgunProxyForNetwork network = case network of
  "helium"  -> Nothing  -- TODO: Set when deployed
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
  , apiConfig = def { ipAddress = flags_apiIPAddress }
  , contractsConfig = getRailgunProxyForNetwork flags_network >>= \addr ->
      Just ContractsConf { railgunProxy = Just addr }
  }

getNodeKey :: IO (VC.PublicKey, Address)
getNodeKey = do
  mgr <- newManager defaultManagerSettings
  let clientEnv = mkClientEnv mgr (vaultProxyUrl (def :: UrlConfig))
  putStrLn "asking vault-wrapper for the node's key, or to create one, if it does not exist"
  ak <- waitOnVault clientEnv $ runClientM (getKey Nothing Nothing) clientEnv
  return (VC.unPubKey ak, VC.unAddress ak)

waitOnVault :: ClientEnv -> IO (Either ClientError VC.AddressAndKey) -> IO VC.AddressAndKey
waitOnVault clientEnv request = do
  res <- request
  case res of
    Left (FailureResponse _ (Response (Status code _) _ _ body)) -> case code of
      503 -> do
        -- 503 is thrown when the password is not set
        putStrLn "vault password is not set. I'll keep trying until it is set"
        threadDelay 2000000 -- 2 seconds
        waitOnVault clientEnv request
      400 ->
        -- 400 is thrown when the key does not exist
        if flags_generateKey
          then do
            putStrLn "nodekey does not exist -  I'm going to create one"
            waitOnVault clientEnv $ runClientM (postKey Nothing) clientEnv
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
  pgUser <- case flags_pguser of
    "" -> do
      putStrLn "using default postgres user: postgres"
      return "postgres"
    u -> return u

  pgHost <- case flags_pghost of
    "" -> do
      putStrLn "using default postgres host: localhost"
      return "localhost"
    h -> return h

  pgPass <- case flags_password of
    "" -> error "specify password for postgres user: "
    p -> return p

  kafkaHost' <- case flags_kafkahost of
    "" -> do
      putStrLn "using default kafka host: localhost"
      return "localhost"
    h -> return h

  (pub, addr) <- getNodeKey
  putStrLn $ "the node's public key: " ++ format pub
  putStrLn $ "the node's address: " ++ format addr

  return runtimeConfig
    { sqlConfig = (sqlConfig runtimeConfig)
        { user = pgUser
        , host = pgHost
        , password = pgPass
        }
    , cirrusConfig = (cirrusConfig runtimeConfig)
        { user = pgUser
        , host = pgHost
        , password = pgPass
        }
    , kafkaConfig = (kafkaConfig runtimeConfig) { kafkaHost = kafkaHost' }
    , blockConfig = def
        { blockTime = flags_blockTime
        , minBlockDifficulty = flags_minBlockDifficulty
        }
    , quarryConfig = def
        { coinbaseAddress = formatAddressWithoutColor addr
        , lazyBlocks = flags_lazyblocks
        }
    }
