{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE RecordWildCards #-}

module Blockchain.Init.EthConf (genEthConf) where

import Blockchain.EthConf
import Blockchain.Init.Options
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Options (flags_network)
import Data.Default

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
        { lazyBlocks = flags_lazyblocks
        }
    }
