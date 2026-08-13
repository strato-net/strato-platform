{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Init.DockerCompose (generateDockerCompose) where

import Prelude hiding (init)

import Blockchain.EthConf (ethConf)
import Blockchain.EthConf.Model (apiConfig, apiPort, networkConfig, httpPort)
import Blockchain.Init.ComposeTypes
import Blockchain.Init.BuildMetadata
import Blockchain.Init.Options (flags_jsonrpc, flags_kafkaLogRetentionBytes, flags_kafkaLogRetentionHours, flags_kafkaLogSegmentBytes, flags_localAuth, flags_minimalServices, flags_publicStratoRpc, flags_sslDir)
import Control.Monad.Composable.Streaming.DockerConfig (BrokerConfig(..), brokerConfig)
import Strato.Version (stratoVersionTag)
import Data.Default (def)
import qualified Data.Map as Map
import qualified Data.Yaml as Yaml
import System.Posix.User (getEffectiveUserID, getEffectiveGroupID)
import System.Process (readProcess)

generateDockerCompose :: IO ()
generateDockerCompose = do
  uid <- show <$> getEffectiveUserID
  gid <- show <$> getEffectiveGroupID
  
  localHostname <- filter (/= '\n') <$> readProcess "hostname" [] ""

  let conf = ethConf
      ssl = not $ null flags_sslDir
      portNum = show $ httpPort (networkConfig conf)
      rpcPort = "8545"
      stratoApiPort = show $ apiPort (apiConfig conf)
      userGid = uid ++ ":" ++ gid
      hostGateway = Just [localHostname ++ ":host-gateway"]

  -- Disable Docker logging since we redirect stdout/stderr to files
  let noLogging = Just Logging
        { driver = "none"
        , options = Nothing
        }

  let appBackend = def
        { image = "app-backend:" ++ stratoVersionTag ++ "-" ++ hashAppBackend
        , user = Just userGid
        , depends_on = Just $ DependsOnList ["postgres", "postgrest"]
        , init = Just True
        , extra_hosts = hostGateway
        , volumes = Just
            [ "./logs:/logs"
            , "./secrets/oauth_credentials.yaml:/run/secrets/oauth_credentials.yaml:ro"
            , "./.ethereumH/ethconf.yaml:/config/ethconf.yaml:ro"
            , "./secrets/postgres_password:/run/secrets/postgres_password:ro"
            ]
        , environment = Just $ Map.fromList
            [ ("RPC_URL_MAINNET", "${RPC_URL_MAINNET:-}")
            , ("RPC_URL_MAINNET_FALLBACK", "${RPC_URL_MAINNET_FALLBACK:-}")
            , ("RPC_URL_SEPOLIA", "${RPC_URL_SEPOLIA:-}")
            , ("RPC_URL_SEPOLIA_FALLBACK", "${RPC_URL_SEPOLIA_FALLBACK:-}")
            , ("RPC_URL_BASE", "${RPC_URL_BASE:-}")
            , ("RPC_URL_BASE_FALLBACK", "${RPC_URL_BASE_FALLBACK:-}")
            , ("RPC_URL_BASE_SEPOLIA", "${RPC_URL_BASE_SEPOLIA:-}")
            , ("RPC_URL_BASE_SEPOLIA_FALLBACK", "${RPC_URL_BASE_SEPOLIA_FALLBACK:-}")
            , ("POOL_FACTORY", "${POOL_FACTORY:-}")
            , ("LENDING_REGISTRY", "${LENDING_REGISTRY:-}")
            , ("TOKEN_FACTORY", "${TOKEN_FACTORY:-}")
            , ("ADMIN_REGISTRY", "${ADMIN_REGISTRY:-}")
            , ("MERCATA_BRIDGE", "${MERCATA_BRIDGE:-}")
            , ("STRATO_NATIVE_BRIDGE", "${STRATO_NATIVE_BRIDGE:-}")
            , ("STRATO_NATIVE_CUSTODY_VAULT", "${STRATO_NATIVE_CUSTODY_VAULT:-}")
            , ("WAGMI_PROJECT_ID", "${WAGMI_PROJECT_ID:-}")
            , ("STRIPE_SECRET_KEY", "${STRIPE_SECRET_KEY:-}")
            , ("STRIPE_PUBLISHABLE_KEY", "${STRIPE_PUBLISHABLE_KEY:-}")
            , ("STRIPE_WEBHOOK_SECRET", "${STRIPE_WEBHOOK_SECRET:-}")
            , ("ONRAMP_HOT_WALLET_ADDRESS", "${ONRAMP_HOT_WALLET_ADDRESS:-}")
            , ("BA_USERNAME", "${BA_USERNAME:-}")
            , ("BA_PASSWORD", "${BA_PASSWORD:-}")
            , ("SAVE_USDST_VAULT", "${SAVE_USDST_VAULT:-}")
            , ("SENDGRID_API_KEY", "${SENDGRID_API_KEY:-}")
            , ("postgres_host", "postgres")
            , ("postgres_port", "5432")
            , ("postgres_user", "postgres")
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec docker-entrypoint.sh sh docker-run.sh >> /logs/app-backend.log 2>&1"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let appUi = def
        { image = "app-ui:" ++ stratoVersionTag ++ "-" ++ hashAppUi
        , user = Just userGid
        , depends_on = Just $ DependsOnList ["app-backend"]
        , volumes = Just ["./logs:/logs", "./.ethereumH/ethconf.yaml:/config/ethconf.yaml:ro"]
        , environment = Just $ Map.fromList
            [ ("LUCKY_ORANGE_SITE_ID", "${LUCKY_ORANGE_SITE_ID:-}")
            , ("GOOGLE_ANALYTICS_ID", "${GOOGLE_ANALYTICS_ID:-}")
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec docker-entrypoint.sh sh docker-run.sh >> /logs/app-ui.log 2>&1"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let smd = def
        { image = "smd:" ++ stratoVersionTag ++ "-" ++ hashSmd
        , user = Just userGid
        , depends_on = Just $ DependsOnList ["apex", "postgrest", "prometheus"]
        , extra_hosts = hostGateway
        , volumes = Just ["./logs:/logs", "./.ethereumH/ethconf.yaml:/config/ethconf.yaml:ro"]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec docker-entrypoint.sh sh /usr/src/app/docker-run.sh >> /logs/smd.log 2>&1"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let apex = def
        { image = "apex:" ++ stratoVersionTag ++ "-" ++ hashApex
        , user = Just userGid
        , depends_on = Just $ DependsOnList ["postgres", "prometheus", "redis"]
        , extra_hosts = hostGateway
        , environment = Just $ Map.fromList
            [ ("postgres_host", "postgres")
            , ("postgres_port", "5432")
            , ("postgres_user", "postgres")
            , ("redis_host", "redis")
            , ("redis_port", "6379")
            ]
        , volumes = Just
            [ "./logs:/logs"
            , "./secrets/postgres_password:/run/secrets/postgres_password:ro"
            , "./.ethereumH/ethconf.yaml:/config/ethconf.yaml:ro"
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec docker-entrypoint.sh /usr/src/app/docker-run.sh >> /logs/apex.log 2>&1"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let redis = def
        { image = "redis:3.2"
        , user = Just userGid
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec docker-entrypoint.sh redis-server --appendonly yes >> /logs/redis.log 2>&1"]
        , restart = Just "unless-stopped"
        , healthcheck = Just Healthcheck
            { test = ["CMD", "redis-cli", "ping"]
            , interval = Just "2s"
            , timeout = Just "2s"
            , retries = Just 10
            , start_period = Nothing
            }
        , logging = noLogging
        , volumes = Just ["./logs:/logs", "./redis:/data"]
        , ports = Just ["127.0.0.1:6379:6379"]
        }

  let postgrest = def
        { image = "postgrest:" ++ stratoVersionTag ++ "-" ++ hashPostgrest
        , user = Just userGid
        , depends_on = Just $ DependsOnList ["postgres"]
        , environment = Just $ Map.fromList
            [ ("PG_ENV_POSTGRES_DB", "cirrus")
            , ("PG_ENV_POSTGRES_HOST", "postgres")
            , ("PG_ENV_POSTGRES_USER", "postgres")
            , ("PG_PORT_5432_TCP_PORT", "5432")
            , ("POSTGREST_LOG_LEVEL", "error")
            ]
        , volumes = Just
            [ "./logs:/logs"
            , "./secrets/postgres_password:/run/secrets/postgres_password:ro"
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec sh /doit.sh >> /logs/postgrest.log 2>&1"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let postgres = def
        { image = "postgres:14.18"
        , shm_size = Just "1g"
        , user = Just userGid
        , environment = Just $ Map.fromList
            [ ("POSTGRES_DB", "eth")
            , ("POSTGRES_PASSWORD_FILE", "/run/secrets/postgres_password")
            ]
        , volumes = Just
            [ "./logs:/logs"
            , "./postgres:/var/lib/postgresql/data"
            , "./secrets/postgres_password:/run/secrets/postgres_password:ro"
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec docker-entrypoint.sh postgres -c max_connections=800 -c shared_buffers=512MB >> /logs/postgres.log 2>&1"]
        , restart = Just "unless-stopped"
        , healthcheck = Just Healthcheck
            { test = ["CMD-SHELL", "pg_isready -U postgres"]
            , interval = Just "2s"
            , timeout = Just "2s"
            , retries = Just 10
            , start_period = Nothing
            }
        , logging = noLogging
        , ports = Just ["127.0.0.1:5432:5432"]
        }


  let nginx = def
        { image = "nginx:" ++ stratoVersionTag ++ "-" ++ hashNginx
        , extra_hosts = hostGateway
        , depends_on = Just $
            if flags_localAuth
              then DependsOnMap $ Map.fromList
                [ ("apex", DependsOnCondition "service_started")
                , ("docs", DependsOnCondition "service_started")
                , ("postgrest", DependsOnCondition "service_started")
                , ("prometheus", DependsOnCondition "service_started")
                , ("smd", DependsOnCondition "service_started")
                , ("app-backend", DependsOnCondition "service_started")
                , ("app-ui", DependsOnCondition "service_started")
                , ("local-auth", DependsOnCondition "service_healthy")
                ]
              else DependsOnList
                ["apex", "docs", "postgrest", "prometheus", "smd", "app-backend", "app-ui"]
        
        , environment = Just $ Map.fromList $
            [ ("STRATO_PORT_API", stratoApiPort)
            , ("STRATO_PORT_VAULT_PROXY", "8013")
            , ("JSONRPC_ENABLED", if flags_jsonrpc then "true" else "false")
            , ("PUBLIC_STRATO_RPC_ENABLED", if flags_publicStratoRpc then "true" else "false")
            , ("RPC_PORT", rpcPort)
            , ("TRACKING_ENABLED", "true")
            , ("TRACKING_URL", "https://go.strato.nexus")
            , ("ssl", if ssl then "true" else "false")
            ]
            ++ if flags_localAuth
               then [ ("OAUTH_DISCOVERY_URL", "http://local-auth:4444/.well-known/openid-configuration")
                    ]
               else []
        , ports = Just [portNum ++ ":" ++ portNum, "443:443"]
        , volumes = Just
            [ "./logs:/logs"
            , "./secrets/ssl:/etc/ssl/strato:ro"
            , "./secrets/oauth_credentials.yaml:/run/secrets/oauth_credentials.yaml:ro"
            , "./.ethereumH/ethconf.yaml:/config/ethconf.yaml:ro"
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        -- chmod so the host user's strato-logrotate can rotate (truncate) the
        -- log: this container runs as root, not as the host uid.
        , command = Just ["touch /logs/nginx.log && chmod 666 /logs/nginx.log || true; exec /docker-run.sh >> /logs/nginx.log 2>&1"]
        , restart = Just "unless-stopped"
        , healthcheck = Just Healthcheck
            { test = ["CMD", "curl", "-sf", "http://localhost:" ++ portNum ++ "/_ping"]
            , interval = Just "5s"
            , timeout = Just "1s"
            , retries = Nothing
            , start_period = Just "30s"
            }
        , logging = noLogging
        }

  let docs = def
        { image = "swaggerapi/swagger-ui:v5.29.2"
        , user = Just userGid
        , environment = Just $ Map.fromList [("API_URL", "/docs/swagger.yaml")]
        , volumes = Just ["./logs:/logs"]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec /docker-entrypoint.sh nginx -g 'daemon off;' >> /logs/docs.log 2>&1"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  -- Message broker service (configured via streaming package). The retention
  -- flags are only meaningful for the Kafka backend, so they are merged in
  -- (left-biased union) only when the broker environment is Kafka's.
  -- The flags are used during the network snapshot creation to avoid including the old consumed logs and
  -- keep the snapshot size smaller.
  let bc = brokerConfig
      kafkaRetentionEnv = Map.fromList
        [ ("KAFKA_LOG_RETENTION_HOURS", show flags_kafkaLogRetentionHours)
        , ("KAFKA_LOG_RETENTION_BYTES", show flags_kafkaLogRetentionBytes)
        , ("KAFKA_LOG_SEGMENT_BYTES", show flags_kafkaLogSegmentBytes)
        ]
      applyKafkaRetention env
        | Map.member "KAFKA_LOG_DIRS" env = Map.union kafkaRetentionEnv env
        | otherwise = env
      streaming = def
        { image = bcImage bc
        , user = if bcNeedsUserGid bc then Just userGid else Nothing
        , environment = applyKafkaRetention <$> bcEnvironment bc
        , entrypoint = bcEntrypoint bc
        , command = bcCommand bc
        , restart = Just "unless-stopped"
        , healthcheck = Just Healthcheck
            { test = bcHealthcheckTest bc
            , interval = Just "5s"
            , timeout = Just "10s"
            , retries = Just 10
            , start_period = Nothing
            }
        , volumes = Just (bcVolumes bc)
        , logging = noLogging
        , ports = Just ["127.0.0.1:" ++ show (bcPort bc) ++ ":" ++ show (bcPort bc)]
        }

  let prometheus = def
        { image = "prometheus:" ++ stratoVersionTag ++ "-" ++ hashPrometheus
        , user = Just userGid
        , extra_hosts = hostGateway
        , volumes = Just
            [ "./logs:/logs"
            , "./prometheus:/prometheus"
            , "./.ethereumH/ethconf.yaml:/config/ethconf.yaml:ro"
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec /entrypoint.sh >> /logs/prometheus.log 2>&1"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let localAuth = def
        { image = "local-auth:" ++ stratoVersionTag ++ "-" ++ hashLocalAuth
        , depends_on = Just $ DependsOnList ["postgres"]
        , extra_hosts = hostGateway
        , environment = Just $ Map.fromList
            $ [ ("DSN", "postgres://postgres@postgres:5432/kratos?sslmode=disable")
              , ("HYDRA_DSN", "postgres://postgres@postgres:5432/hydra?sslmode=disable")
              ]
            ++ if flags_minimalServices
              then [("OAUTH_ISSUER_URL", "http://127.0.0.1:4444")]
              else []
        , healthcheck = Just Healthcheck
            { test = ["CMD", "curl", "-f", "http://localhost:4444/.well-known/openid-configuration"]
            , interval = Just "5s"
            , timeout = Just "5s"
            , retries = Just 30
            , start_period = Just "30s"
            }
        , volumes = Just
            [ "./logs:/logs"
            , "./secrets:/run/secrets:ro"
            , "./.ethereumH/ethconf.yaml:/config/ethconf.yaml:ro"
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        -- chmod so the host user's strato-logrotate can rotate (truncate) the
        -- log: this container runs as root, not as the host uid.
        , command = Just ["touch /logs/local-auth.log && chmod 666 /logs/local-auth.log || true; exec /entrypoint.sh >> /logs/local-auth.log 2>&1"]
        , ports = Just ["127.0.0.1:4444:4444"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  -- Lightweight JWT-verifying proxy for the host-side vault wrapper. The full
  -- stack performs this function in nginx; minimal nodes omit that container,
  -- so they use the dedicated vault proxy on a loopback-only port instead.
  let vaultNginx = def
        { image = "vault-nginx:" ++ stratoVersionTag
        , depends_on = Just $ DependsOnMap $ Map.fromList
            [("local-auth", DependsOnCondition "service_healthy")]
        , extra_hosts = hostGateway
        , environment = Just $ Map.fromList
            [ ("INITIAL_OAUTH_DISCOVERY_URL", "http://local-auth:4444/.well-known/openid-configuration")
            , ("INITIAL_OAUTH_ISSUER", "http://127.0.0.1:4444")
            , ("INITIAL_OAUTH_JWT_USER_ID_CLAIM", "sub")
            , ("VAULT_WRAPPER_HOST", localHostname ++ ":8093")
            , ("WAIT_FOR_VAULT_WRAPPER", "false")
            , ("ssl", "false")
            ]
        , ports = Just ["127.0.0.1:8094:80"]
        , restart = Just "unless-stopped"
        }

  -- Only include streaming service if a broker image is configured (not embedded like JLog)
  let streamingService = if null (bcImage bc) then [] else [("streaming", streaming)]
  
  let fullServices =
        [ ("app-backend", appBackend)
        , ("app-ui", appUi)
        , ("smd", smd)
        , ("apex", apex)
        , ("redis", redis)
        , ("postgrest", postgrest)
        , ("postgres", postgres)
        , ("nginx", nginx)
        , ("docs", docs)
        , ("prometheus", prometheus)
        ] ++ streamingService

      minimalServices =
        [ ("redis", redis)
        , ("postgres", postgres)
        ] ++ streamingService

      baseServices = if flags_minimalServices then minimalServices else fullServices

  let allServices = if flags_localAuth
        then ("local-auth", localAuth)
          : ((if flags_minimalServices then [("vault-nginx", vaultNginx)] else [])
          ++ baseServices)
        else baseServices

  let composeFile = ComposeFile
        { namedVolumes = Nothing
        , services = Map.fromList allServices
        }

  Yaml.encodeFile "docker-compose.yml" composeFile
  putStrLn "  ✓ Generated docker-compose.yml"
