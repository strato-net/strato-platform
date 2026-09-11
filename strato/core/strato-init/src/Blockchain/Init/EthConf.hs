{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE RecordWildCards #-}

module Blockchain.Init.EthConf (genEthConf, preferIPv4Loopback, runtimeConfig, flagsNetworkIdentity) where

import Blockchain.EthConf
import Blockchain.Init.Options hiding (flags_localAuth)
import Blockchain.Init.Role
import Control.Monad.Composable.Streaming.DockerConfig (brokerConfig, bcHost, bcPort)
import qualified Blockchain.Init.Options as Opts
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
import System.Environment (lookupEnv)
import System.Process (readProcess)
import Text.ShortDescription

-- | Address strato-api binds its socket to: @--apiIPAddress@ when given,
-- otherwise the docker bridge on Linux (so the nginx container reaches the
-- host process) and loopback elsewhere.
getApiListenAddress :: String
getApiListenAddress
  | not (null flags_apiIPAddress) = flags_apiIPAddress
  | os == "linux" = "172.17.0.1"
  | otherwise = "127.0.0.1"

-- | In local mode the generated docker-compose.yml publishes Postgres/Redis only
-- on IPv4 (127.0.0.1:PORT). macOS resolves "localhost" to IPv6 (::1) first, so
-- local STRATO processes fail to connect ("connection to server at \"localhost\"
-- (::1) ... Connection refused"). Pin the default "localhost" to the IPv4 loopback
-- the ports are actually bound to. On Linux "localhost" already resolves to
-- 127.0.0.1, so this is a no-op there. Explicit non-localhost hosts (e.g. the
-- "postgres" docker service name used in allDocker mode) are left untouched.
preferIPv4Loopback :: String -> String
preferIPv4Loopback "localhost" = "127.0.0.1"
preferIPv4Loopback h = h

-- | Get Railgun contract addresses for known networks
-- Returns Nothing for networks where contracts haven't been deployed yet
getRailgunProxyForNetwork :: String -> Maybe Address
getRailgunProxyForNetwork network = case network of
  "helium"  -> Just 0x84340ae5a421a216339d74173aa39408aab61d74
  "upquark" -> Nothing  -- TODO: Set when deployed
  "lithium" -> Nothing  -- TODO: Set when deployed
  _         -> Nothing

getNativeTokenForNetwork :: String -> Address
getNativeTokenForNetwork _ = 0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010

-- | Runtime config that overrides defaults with command-line flags
runtimeConfig :: EthConf
runtimeConfig = def
  { sqlConfig = def { host = "postgres" }
  , cirrusConfig = def { host = "postgres", database = "cirrus" }
  , redisBlockDBConfig = def
      { redisHost = preferIPv4Loopback flags_redisHost
      , redisPort = flags_redisPort
      , redisDBNumber = flags_redisDBNumber
      }
  , edgeRedisConfig = def
      { redisHost = preferIPv4Loopback flags_edgeRedisHost
      , redisPort = flags_edgeRedisPort
      }
  , streamingConfig = def
      { streamingHost = bcHost brokerConfig
      , streamingPort = bcPort brokerConfig
      }
  , discoveryConfig = def { minAvailablePeers = flags_minPeers }
  , p2pConfig = def
      { maxConnections = flags_maxConn
      , connectionTimeout = flags_connectionTimeout
      , maxReturnedHeaders = flags_maxReturnedHeaders
      , averageTxsPerBlock = flags_averageTxsPerBlock
      , maxHeadersTxsLens = flags_maxHeadersTxsLens
      }
  , apiConfig = def
      { apiListenAddress = getApiListenAddress
      }
  , contractsConfig = ContractsConf
      { railgunProxy = getRailgunProxyForNetwork flags_network
      , nativeTokenAddress = getNativeTokenForNetwork flags_network
      , nativeTokenBalancesField = Nothing
      }
  , debugConfig = def { svmTrace = flags_svmTrace }
  , vmConfig = def { sqlDiff = flags_sqlDiff, diffPublish = flags_diffPublish }
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

-- | The network identity the current flags describe, exactly as 'genEthConf'
-- writes it: (network name, network id, chain id).
flagsNetworkIdentity :: (String, Integer, Integer)
flagsNetworkIdentity = (flags_network, computeNetworkID, computeChainId flags_network)

genEthConf :: Role -> IO EthConf
genEthConf role = do
  pgPass <- filter (/= '\n') <$> readFile "secrets/postgres_password"

  localHostname <- filter (/= '\n') <$> readProcess "hostname" [] ""

  let ssl = not $ null flags_sslDir
      !nodeBaseUrl = (if ssl then "https://" else "http://")
        ++ localHostname
        ++ if ssl then "" else ":" ++ show flags_httpPort

  -- For local auth mode, skip vault during setup (vault-wrapper starts later).
  -- An API-only directory has no node identity: it signs nothing.
  if Opts.flags_localAuth
    then putStrLn $ "  ✓ Local auth mode (hostname: " ++ localHostname ++ "): node key will be provisioned during first admin setup"
    else if not (roleRunsCore role)
      then putStrLn "  ✓ API role: no node key needed"
      else do
        (pub, _addr) <- getNodeKey
        putStrLn $ "  ✓ Node key: " ++ shortDescription pub

  -- On an API-only host both listeners face only the nginx container, so
  -- the JSON-RPC server binds where strato-api does instead of everywhere,
  -- and bloc's simulation calls follow it there.
  let apiConf = apiConfig runtimeConfig
      roleApiConfig
        | role == RoleApi = apiConf { rpcListenAddress = getApiListenAddress }
        | otherwise = apiConf
      roleVmConfig
        | role == RoleApi =
            (vmConfig runtimeConfig) { vmJsonRpcUrl = "http://" ++ getApiListenAddress ++ ":" ++ show (rpcPort apiConf) }
        | otherwise = vmConfig runtimeConfig

  -- An API-only directory reads through the replica endpoint when one is
  -- given; its writes (and consistency-sensitive reads) stay on --pghost.
  let readerHost = if null flags_pgReaderHost || role /= RoleApi then Nothing else Just flags_pgReaderHost
      writerSql = (sqlConfig runtimeConfig)
        { user = flags_pguser
        , host = preferIPv4Loopback flags_pghost
        , password = pgPass
        }

  envSaslPassword <- lookupEnv "bus_sasl_password"
  let saslPassword = case (flags_busSaslPassword, envSaslPassword) of
        (p, _) | not (null p) -> Just p
        (_, Just p) | not (null p) -> Just p
        _ -> Nothing
      busConf
        | null flags_busHost = Nothing
        | otherwise = Just def
            { busHost = flags_busHost
            , busPort = flags_busPort
            , busSecurity = flags_busSecurity
            , busSaslUsername = if null flags_busSaslUsername then Nothing else Just flags_busSaslUsername
            , busSaslPassword = saslPassword
            , busSubmitMode = flags_busSubmitMode
            }

  return runtimeConfig
    { apiConfig = roleApiConfig
    , busConfig = busConf
    , vmConfig = roleVmConfig { vmQueryUrl = if flags_vmQuery then Just "http://127.0.0.1:8546" else Nothing }
    , cellId = if null flags_cellId then Nothing else Just flags_cellId
    , peerDbConfig = if null flags_peerDatabase then Nothing else Just writerSql { database = flags_peerDatabase }
    , sqlConfig = writerSql
    , sqlReaderConfig = (\h -> writerSql { host = h }) <$> readerHost
    , cirrusConfig = (cirrusConfig runtimeConfig)
        { user = flags_pguser
        , host = maybe (preferIPv4Loopback flags_pghost) id readerHost
        , password = pgPass
        }
    , streamingConfig = (streamingConfig runtimeConfig)
        { streamingHost = if flags_kafkahost == "localhost"
                          then bcHost brokerConfig
                          else flags_kafkahost 
        , streamingPort = if flags_kafkahost == "localhost"
                          then bcPort brokerConfig
                          else flags_kafkaport
        }
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
        { nodeUrl = nodeBaseUrl
        , vaultUrl = if Opts.flags_localAuth
            then nodeBaseUrl ++ "/vault/strato/v2.3"
            else flags_vaultUrl
        , vaultTimeoutSec = flags_vaultTimeoutSec
        , fileServerUrl = deriveFileServerUrl flags_fileServerUrl flags_network
        , notificationServerUrl = flags_notificationServerUrl
        , repoUrl = flags_repoUrl
        , cookieRealm = localHostname
        }
    , networkConfig = def
        { network = flags_network
        , networkID = computeNetworkID
        , chainId = computeChainId flags_network
        , httpPort = flags_httpPort
        , txSizeLimit = flags_txSizeLimit
        , gasLimit = flags_gasLimit
        , blockPeriodMs = flags_blockstanbul_block_period_ms
        , roundPeriodS = flags_blockstanbul_round_period_s
        , stakingActivationBlock =
            if flags_stakingActivationBlock < 0
              then defaultStakingActivationBlock flags_network
              else Just flags_stakingActivationBlock
        -- These two must be re-derived from flags_network. 'def' hardcodes
        -- upquark's values, and ToJSON writes every field, so leaving them
        -- alone bakes upquark's staking proxy into a helium node's
        -- ethconf.yaml. FromJSON's per-network fallback can never fire after
        -- that, because the key is present. The node then watches an address
        -- that emits nothing on its network, derives no stake updates, and
        -- dies with StakeMismatch on the first block whose header carries one.
        , stakingContractAddress = defaultStakingContractAddress flags_network
        -- An explicit --stakingActivationBlock has to carry the stake-event
        -- source with it. The per-network default resolves to Nothing for a
        -- network name this build has never heard of, and Nothing here means
        -- "never switch to governance"; combined with stakingContractAddress
        -- also being Nothing for a new network, stakeEventSourceAt would yield
        -- no source at any height. Staking would activate at the requested
        -- block with nothing publishing weights.
        , stakingEventsFromGovernanceBlock =
            if flags_stakingActivationBlock < 0
              then defaultStakingEventsFromGovernanceBlock flags_network
              else Just flags_stakingActivationBlock
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
deriveFileServerUrl "" "beryllium" = "https://fileserver.mercata.blockapps.net/highway"
deriveFileServerUrl "" _ = ""  -- Unknown networks get empty string
deriveFileServerUrl url _ = url  -- Explicit URL takes precedence
