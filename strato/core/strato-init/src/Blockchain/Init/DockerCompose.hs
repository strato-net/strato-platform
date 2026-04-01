{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Init.DockerCompose (generateDockerCompose) where

import Prelude hiding (init)

import Blockchain.EthConf (ethConf)
import Blockchain.EthConf.Model (apiConfig, apiPort, apiHost, networkConfig, httpPort)
import Blockchain.Init.ComposeTypes
import Blockchain.Init.BuildMetadata
import Blockchain.Init.Options (flags_localAuth, flags_sslDir, flags_nodeHost)
import Blockchain.Strato.Version (stratoVersionTag)
import Data.Default (def)
import qualified Data.Map as Map
import qualified Data.Yaml as Yaml
import System.Posix.User (getEffectiveUserID, getEffectiveGroupID)

generateDockerCompose :: IO ()
generateDockerCompose = do
  uid <- show <$> getEffectiveUserID
  gid <- show <$> getEffectiveGroupID
  
  let conf = ethConf
      ssl = not $ null flags_sslDir
      portNum = show $ httpPort (networkConfig conf)
      stratoApiPort = show $ apiPort (apiConfig conf)
      nodeHost = if ssl then flags_nodeHost else flags_nodeHost ++ ":" ++ portNum
      sHost = apiHost (apiConfig conf)
      userGid = uid ++ ":" ++ gid

  -- Disable Docker logging since we redirect stdout/stderr to files
  let noLogging = Just Logging
        { driver = "none"
        , options = Nothing
        }

  let mercataBackend = def
        { image = "mercata-backend:" ++ stratoVersionTag ++ "-" ++ hashMercataBackend
        , depends_on = Just $ DependsOnList ["postgrest"]
        , init = Just True
        , volumes = Just
            [ "./logs:/logs"
            , "./secrets/oauth_credentials.yaml:/run/secrets/oauth_credentials.yaml:ro"
            , "./.ethereumH/ethconf.yaml:/config/ethconf.yaml:ro"
            ]
        , environment = Just $ Map.fromList
            [ ("NODE_URL", "http://nginx:" ++ portNum)
            , ("RPC_URL_MAINNET", "${RPC_URL_MAINNET}")
            , ("RPC_URL_MAINNET_FALLBACK", "${RPC_URL_MAINNET_FALLBACK}")
            , ("RPC_URL_SEPOLIA", "${RPC_URL_SEPOLIA}")
            , ("RPC_URL_SEPOLIA_FALLBACK", "${RPC_URL_SEPOLIA_FALLBACK}")
            , ("RPC_URL_BASE", "${RPC_URL_BASE}")
            , ("RPC_URL_BASE_FALLBACK", "${RPC_URL_BASE_FALLBACK}")
            , ("RPC_URL_BASE_SEPOLIA", "${RPC_URL_BASE_SEPOLIA}")
            , ("RPC_URL_BASE_SEPOLIA_FALLBACK", "${RPC_URL_BASE_SEPOLIA_FALLBACK}")
            , ("POOL_FACTORY", "${POOL_FACTORY}")
            , ("LENDING_REGISTRY", "${LENDING_REGISTRY}")
            , ("TOKEN_FACTORY", "${TOKEN_FACTORY}")
            , ("ADMIN_REGISTRY", "${ADMIN_REGISTRY}")
            , ("MERCATA_BRIDGE", "${MERCATA_BRIDGE}")
            , ("WAGMI_PROJECT_ID", "${WAGMI_PROJECT_ID}")
            , ("STRIPE_SECRET_KEY", "${STRIPE_SECRET_KEY}")
            , ("STRIPE_PUBLISHABLE_KEY", "${STRIPE_PUBLISHABLE_KEY}")
            , ("STRIPE_WEBHOOK_SECRET", "${STRIPE_WEBHOOK_SECRET}")
            , ("ONRAMP_HOT_WALLET_ADDRESS", "${ONRAMP_HOT_WALLET_ADDRESS}")
            , ("BA_USERNAME", "${BA_USERNAME}")
            , ("BA_PASSWORD", "${BA_PASSWORD}")
            , ("SAVE_USDST_VAULT", "${SAVE_USDST_VAULT}")
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec docker-entrypoint.sh sh docker-run.sh >> /logs/mercata-backend.log 2>&1"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let mercataUi = def
        { image = "mercata-ui:" ++ stratoVersionTag ++ "-" ++ hashMercataUi
        , depends_on = Just $ DependsOnList ["mercata-backend"]
        , volumes = Just ["./logs:/logs"]
        , environment = Just $ Map.fromList
            [ ("LUCKY_ORANGE_SITE_ID", "${LUCKY_ORANGE_SITE_ID}")
            , ("GOOGLE_ANALYTICS_ID", "${GOOGLE_ANALYTICS_ID}")
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec docker-entrypoint.sh sh docker-run.sh >> /logs/mercata-ui.log 2>&1"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let smd = def
        { image = "smd:" ++ stratoVersionTag ++ "-" ++ hashSmd
        , depends_on = Just $ DependsOnList ["apex", "postgrest", "prometheus"]
        , environment = Just $ Map.fromList
            [ ("NODE_HOST", nodeHost)
            , ("ssl", if ssl then "true" else "false")
            ]
        , volumes = Just ["./logs:/logs"]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec docker-entrypoint.sh sh /usr/src/app/docker-run.sh >> /logs/smd.log 2>&1"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let apex = def
        { image = "apex:" ++ stratoVersionTag ++ "-" ++ hashApex
        , depends_on = Just $ DependsOnList ["postgres", "prometheus"]
        , environment = Just $ Map.fromList
            [ ("postgres_host", "postgres")
            , ("postgres_port", "5432")
            , ("postgres_user", "postgres")
            , ("STRATO_HOSTNAME", sHost)
            , ("STRATO_PORT_API", stratoApiPort)
            , ("STRATO_PORT_VAULT_PROXY", "8013")
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
        , ports = Just ["6379:6379"]
        }

  let postgrest = def
        { image = "postgrest:" ++ stratoVersionTag ++ "-" ++ hashPostgrest
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
        , command = Just ["exec docker-entrypoint.sh postgres -c max_connections=300 -c shared_buffers=512MB >> /logs/postgres.log 2>&1"]
        , restart = Just "unless-stopped"
        , healthcheck = Just Healthcheck
            { test = ["CMD-SHELL", "pg_isready -U postgres"]
            , interval = Just "2s"
            , timeout = Just "2s"
            , retries = Just 10
            , start_period = Nothing
            }
        , logging = noLogging
        , ports = Just ["5432:5432"]
        }


  let nginx = def
        { image = "nginx:" ++ stratoVersionTag ++ "-" ++ hashNginx
        , depends_on = Just $
            if flags_localAuth
              then DependsOnMap $ Map.fromList
                [ ("apex", DependsOnCondition "service_started")
                , ("docs", DependsOnCondition "service_started")
                , ("postgrest", DependsOnCondition "service_started")
                , ("prometheus", DependsOnCondition "service_started")
                , ("smd", DependsOnCondition "service_started")
                , ("mercata-backend", DependsOnCondition "service_started")
                , ("mercata-ui", DependsOnCondition "service_started")
                , ("local-auth", DependsOnCondition "service_healthy")
                ]
              else DependsOnList
                ["apex", "docs", "postgrest", "prometheus", "smd", "mercata-backend", "mercata-ui"]
        
        , environment = Just $ Map.fromList $
            [ ("STRATO_PORT_API", stratoApiPort)
            , ("STRATO_PORT_VAULT_PROXY", "8013")
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
        , command = Just ["exec /docker-run.sh >> /logs/nginx.log 2>&1"]
        , restart = Just "unless-stopped"
        , healthcheck = Just Healthcheck
            { test = ["CMD", "curl", "-sf", "http://localhost:" ++ portNum ++ "/_ping"]
            , interval = Just "5s"
            , timeout = Just "1s"
            , retries = Nothing
            , start_period = Nothing
            }
        , logging = noLogging
        }

  let docs = def
        { image = "swaggerapi/swagger-ui:v5.29.2"
        , environment = Just $ Map.fromList [("API_URL", "/docs/swagger.yaml")]
        , volumes = Just ["./logs:/logs"]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec /docker-entrypoint.sh nginx -g 'daemon off;' >> /logs/docs.log 2>&1"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let kafka = def
        { image = "apache/kafka:3.9.2"
        , environment = Just $ Map.fromList
            [ ("KAFKA_NODE_ID", "1")
            , ("KAFKA_PROCESS_ROLES", "broker,controller")
            , ("KAFKA_LISTENERS", "PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093")
            , ("KAFKA_ADVERTISED_LISTENERS", "PLAINTEXT://localhost:9092")
            , ("KAFKA_CONTROLLER_LISTENER_NAMES", "CONTROLLER")
            , ("KAFKA_LISTENER_SECURITY_PROTOCOL_MAP", "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT")
            , ("KAFKA_CONTROLLER_QUORUM_VOTERS", "1@localhost:9093")
            , ("KAFKA_LOG_DIRS", "/kafka/kafka-logs")
            , ("KAFKA_DELETE_TOPIC_ENABLE", "true")
            , ("KAFKA_LOG_CLEANER_ENABLE", "true")
            , ("KAFKA_LOG_RETENTION_HOURS", "168")
            , ("KAFKA_OFFSET_METADATA_MAX_BYTES", "1048576")
            , ("KAFKA_OFFSETS_RETENTION_MINUTES", "2147483647")
            , ("KAFKA_MAX_REQUEST_SIZE", "2500000")
            , ("KAFKA_MESSAGE_MAX_BYTES", "2500000")
            , ("KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR", "1")
            , ("KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR", "1")
            , ("KAFKA_TRANSACTION_STATE_LOG_MIN_ISR", "1")
            ]
        , restart = Just "unless-stopped"
        , healthcheck = Just Healthcheck
            { test = ["CMD-SHELL", "/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server localhost:9092 || exit 1"]
            , interval = Just "5s"
            , timeout = Just "10s"
            , retries = Just 10
            , start_period = Nothing
            }
        , volumes = Just ["./logs:/logs", "./kafka:/kafka"]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec /__cacert_entrypoint.sh /etc/kafka/docker/run >> /logs/kafka.log 2>&1"]
        , logging = noLogging
        , ports = Just ["9092:9092"]
        }

  let prometheus = def
        { image = "prometheus:" ++ stratoVersionTag ++ "-" ++ hashPrometheus
        , user = Just userGid
        , environment = Just $ Map.fromList
            [ ("NODE_HOST", nodeHost)
            ]
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
        , environment = Just $ Map.fromList
            [ ("DSN", "postgres://postgres@postgres:5432/kratos?sslmode=disable")
            , ("HYDRA_DSN", "postgres://postgres@postgres:5432/hydra?sslmode=disable")
            , ("URLS_SELF_ISSUER", "http://127.0.0.1:" ++ portNum ++ "/auth")
            , ("URLS_LOGIN", "http://localhost:" ++ portNum ++ "/auth/ui/login")
            , ("URLS_CONSENT", "http://localhost:" ++ portNum ++ "/auth/ui/consent")
            ]
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
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec /entrypoint.sh >> /logs/local-auth.log 2>&1"]
        , ports = Just ["4444:4444"]  -- Only expose Hydra OAuth port; login UI accessed via nginx proxy
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let baseServices =
            [ ("mercata-backend", mercataBackend)
            , ("mercata-ui", mercataUi)
            , ("smd", smd)
            , ("apex", apex)
            , ("redis", redis)
            , ("postgrest", postgrest)
            , ("postgres", postgres)
            , ("nginx", nginx)
            , ("docs", docs)
            , ("kafka", kafka)
            , ("prometheus", prometheus)
            ]

  let allServices = if flags_localAuth
        then ("local-auth", localAuth) : baseServices
        else baseServices

  let composeFile = ComposeFile
        { namedVolumes = Nothing
        , services = Map.fromList allServices
        }

  Yaml.encodeFile "docker-compose.yml" composeFile
  putStrLn "  ✓ Generated docker-compose.yml"
