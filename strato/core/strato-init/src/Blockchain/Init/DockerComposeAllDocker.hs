{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Init.DockerComposeAllDocker (generateDockerComposeAllDocker) where

import Prelude hiding (init)

import Blockchain.Init.BuildMetadata
import Blockchain.Init.ComposeTypes
import Blockchain.Init.Options (flags_repoUrl)
import Blockchain.Strato.Version (stratoVersionTag)
import qualified Data.ByteString as BS
import Data.Default (def)
import qualified Data.Map as Map
import qualified Data.Yaml as Yaml
import System.IO (hPutStrLn, stderr)

generateDockerComposeAllDocker :: IO ()
generateDockerComposeAllDocker = do
  let repoUrl = flags_repoUrl
      stratoVersion = stratoVersionTag
      noLogging = Just Logging { driver = "none", options = Nothing }

  -- Named volumes (top-level)
  let topLevelVolumes = Just $ Map.fromList
        [ ("pgdata", VolumeConfig { volume_driver = Just "local" })
        , ("prometheusdata", VolumeConfig { volume_driver = Just "local" })
        , ("kafkadata", VolumeConfig { volume_driver = Just "local" })
        , ("redisdata", VolumeConfig { volume_driver = Just "local" })
        , ("zookeeperdata", VolumeConfig { volume_driver = Just "local" })
        ]

  let mercataBackend = def
        { image = "${MERCATABACKEND_IMAGE:-" ++ repoUrl ++ "mercata-backend:" ++ stratoVersion ++ "-" ++ hashMercataBackend ++ "}"
        , build = Just "./mercata/backend"
        , depends_on = Just ["strato", "postgrest"]
        , init = Just True
        , environment = Just $ Map.fromList
            [ ("OAUTH_DISCOVERY_URL", "${OAUTH_DISCOVERY_URL}")
            , ("OAUTH_CLIENT_ID", "${OAUTH_CLIENT_ID}")
            , ("OAUTH_CLIENT_SECRET", "${OAUTH_CLIENT_SECRET}")
            , ("NODE_URL", "http://nginx")
            , ("BASE_URL", "https://${NODE_HOST}")
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
            , ("STRATO_HOSTNAME", "${STRATO_HOSTNAME:-strato}")
            , ("STRATO_PORT_API", "${STRATO_PORT_API:-3000}")
            , ("STRIPE_SECRET_KEY", "${STRIPE_SECRET_KEY}")
            , ("STRIPE_PUBLISHABLE_KEY", "${STRIPE_PUBLISHABLE_KEY}")
            , ("STRIPE_WEBHOOK_SECRET", "${STRIPE_WEBHOOK_SECRET}")
            , ("ONRAMP_HOT_WALLET_ADDRESS", "${ONRAMP_HOT_WALLET_ADDRESS}")
            , ("BA_USERNAME", "${BA_USERNAME}")
            , ("BA_PASSWORD", "${BA_PASSWORD}")
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec docker-entrypoint.sh sh docker-run.sh >> /logs/mercata-backend.log 2>&1"]
        , volumes = Just ["./logs:/logs"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let mercataUi = def
        { image = "${MERCATAUI_IMAGE:-" ++ repoUrl ++ "mercata-ui:" ++ stratoVersion ++ "-" ++ hashMercataUi ++ "}"
        , build = Just "./mercata/ui"
        , depends_on = Just ["mercata-backend"]
        , environment = Just $ Map.fromList
            [ ("LUCKY_ORANGE_SITE_ID", "${LUCKY_ORANGE_SITE_ID}")
            , ("GOOGLE_ANALYTICS_ID", "${GOOGLE_ANALYTICS_ID}")
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec docker-entrypoint.sh sh docker-run.sh >> /logs/mercata-ui.log 2>&1"]
        , volumes = Just ["./logs:/logs"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let smd = def
        { image = "${SMD_IMAGE:-" ++ repoUrl ++ "smd:" ++ stratoVersion ++ "-" ++ hashSmd ++ "}"
        , build = Just "."
        , depends_on = Just ["apex", "postgrest", "prometheus", "strato"]
        , environment = Just $ Map.fromList
            [ ("NODE_HOST", "${NODE_HOST}")
            , ("ssl", "${ssl:-false}")
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec docker-entrypoint.sh sh /usr/src/app/docker-run.sh >> /logs/smd.log 2>&1"]
        , volumes = Just ["./logs:/logs"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let apex = def
        { image = "${APEX_IMAGE:-" ++ repoUrl ++ "apex:" ++ stratoVersion ++ "-" ++ hashApex ++ "}"
        , build = Just "."
        , depends_on = Just ["postgres", "prometheus", "strato"]
        , environment = Just $ Map.fromList
            [ ("ADMIN_EMAIL", "${ADMIN_EMAIL}")
            , ("postgres_host", "postgres")
            , ("postgres_port", "5432")
            , ("postgres_user", "postgres")
            , ("PROMETHEUS_HOST", "${PROMETHEUS_HOST:-prometheus:9090}")
            , ("SENDGRID_API_KEY", "${SENDGRID_API_KEY}")
            , ("STRATO_HOSTNAME", "${STRATO_HOSTNAME:-strato}")
            , ("STRATO_PORT_API", "${STRATO_PORT_API:-3000}")
            , ("STRATO_PORT_VAULT_PROXY", "${STRATO_PORT_VAULT_PROXY:-8013}")
            , ("MONITOR_URL", "${MONITOR_URL}")
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec docker-entrypoint.sh /usr/src/app/docker-run.sh >> /logs/apex.log 2>&1"]
        , volumes = Just ["./logs:/logs", "./secrets/postgres_password:/run/secrets/postgres_password:ro"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let redis = def
        { image = "redis:3.2"
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec docker-entrypoint.sh redis-server --appendonly yes >> /logs/redis.log 2>&1"]
        , volumes = Just ["./logs:/logs", "redisdata:/data"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let strato = def
        { image = "${STRATO_IMAGE:-" ++ repoUrl ++ "strato:" ++ stratoVersion ++ "-" ++ hashStrato ++ "}"
        , build = Just "."
        , depends_on = Just ["kafka", "postgres", "redis"]
        , environment = Just $ Map.fromList
            [ ("addBootnodes", "${addBootnodes}")
            , ("API_DEBUG_LOG", "${API_DEBUG_LOG:-false}")
            , ("appFetchLimit", "${appFetchLimit}")
            , ("averageTxsPerBlock", "${averageTxsPerBlock}")
            , ("blockstanbulBlockPeriodMs", "${blockstanbulBlockPeriodMs}")
            , ("blockstanbulRoundPeriodS", "${blockstanbulRoundPeriodS}")
            , ("blockTime", "${blockTime}")
            , ("bootnode", "${bootnode}")
            , ("connectionTimeout", "${connectionTimeout}")
            , ("validatorBehavior", "${validatorBehavior:-true}")
            , ("evmDebugMode", "${evmDebugMode}")
            , ("FILE_SERVER_URL", "${FILE_SERVER_URL}")
            , ("FULL_DEBUG_LOG", "${FULL_DEBUG_LOG:-false}")
            , ("gasLimit", "${gasLimit}")
            , ("generateKey", "${generateKey:-true}")
            , ("INSTRUMENTATION", "${INSTRUMENTATION:-false}")
            , ("kafkaHost", "kafka")
            , ("kafkaPort", "9092")
            , ("lazyBlocks", "${lazyBlocks}")
            , ("maxConn", "${maxConn}")
            , ("maxReturnedHeaders", "${maxReturnedHeaders}")
            , ("maxTxsPerBlock", "${maxTxsPerBlock}")
            , ("minBlockDifficulty", "${minBlockDifficulty}")
            , ("network", "${network}")
            , ("networkID", "${networkID}")
            , ("NOTIFICATION_SERVER_URL", "${NOTIFICATION_SERVER_URL}")
            , ("numMinPeers", "${numMinPeers}")
            , ("OAUTH_DISCOVERY_URL", "${OAUTH_DISCOVERY_URL}")
            , ("OAUTH_CLIENT_ID", "${OAUTH_CLIENT_ID}")
            , ("OAUTH_CLIENT_SECRET", "${OAUTH_CLIENT_SECRET}")
            , ("OAUTH_VAULT_PROXY_ALT_CLIENT_ID", "${OAUTH_VAULT_PROXY_ALT_CLIENT_ID}")
            , ("OAUTH_VAULT_PROXY_ALT_CLIENT_SECRET", "${OAUTH_VAULT_PROXY_ALT_CLIENT_SECRET}")
            , ("OAUTH_RESERVE_SECONDS", "${OAUTH_RESERVE_SECONDS}")
            , ("P2P_DEBUG_LOG", "${P2P_DEBUG_LOG}")
            , ("postgres_host", "postgres")
            , ("postgres_port", "5432")
            , ("postgres_slipstream_db", "cirrus")
            , ("postgres_user", "postgres")
            , ("PROCESS_MONITORING", "${PROCESS_MONITORING:-true}")
            , ("redisBDBNumber", "${redisBDBNumber}")
            , ("redisHost", "redis")
            , ("redisPort", "6379")
            , ("seqMaxEventsPerIter", "${seqMaxEventsPerIter}")
            , ("seqMaxUsPerIter", "${seqMaxUsPerIter}")
            , ("seqRTSOPTs", "${seqRTSOPTs}")
            , ("SEQUENCER_DEBUG_LOG", "${SEQUENCER_DEBUG_LOG:-false}")
            , ("SLIPSTREAM_DEBUG_LOG", "${SLIPSTREAM_DEBUG_LOG:-false}")
            , ("SLIPSTREAM_OPTIONAL", "${SLIPSTREAM_OPTIONAL}")
            , ("strictBlockstanbul", "${strictBlockstanbul}")
            , ("strictGas", "${strictGas}")
            , ("strictGasLimit", "${strictGasLimit}")
            , ("svmTrace", "${svmTrace}")
            , ("sqlDiff", "${sqlDiff}")
            , ("svmDev", "${svmDev}")
            , ("test_mode_bypass_blockstanbul", "${test_mode_bypass_blockstanbul:-false}")
            , ("txSizeLimit", "${txSizeLimit}")
            , ("useCustomGenesis", "${useCustomGenesis}")
            , ("VAULT_URL", "${VAULT_URL}")
            , ("VAULT_PROXY_DEBUG", "${VAULT_PROXY_DEBUG}")
            , ("VM_DEBUG_LOG", "${VM_DEBUG_LOG:-false}")
            , ("vmRunnerRTSOPTs", "${vmRunnerRTSOPTs}")
            , ("zkHost", "zookeeper")
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec /strato/doit.sh >> /logs/strato.log 2>&1"]
        , ports = Just ["30303:30303", "30303:30303/udp"]
        , volumes = Just ["./logs:/logs", "./nodedata:/var/lib/strato", "./secrets/postgres_password:/run/secrets/postgres_password:ro"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let postgrest = def
        { image = "${POSTGREST_IMAGE:-" ++ repoUrl ++ "postgrest:" ++ stratoVersion ++ "-" ++ hashPostgrest ++ "}"
        , build = Just "."
        , depends_on = Just ["postgres"]
        , environment = Just $ Map.fromList
            [ ("blocHost", "${blocHost:-strato:3000}")
            , ("PG_ENV_POSTGRES_DB", "cirrus")
            , ("PG_ENV_POSTGRES_HOST", "postgres")
            , ("PG_ENV_POSTGRES_USER", "postgres")
            , ("PG_PORT_5432_TCP_PORT", "5432")
            , ("POSTGREST_LOG_LEVEL", "${POSTGREST_LOG_LEVEL:-error}")
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec sh /doit.sh >> /logs/postgrest.log 2>&1"]
        , volumes = Just ["./logs:/logs", "./secrets/postgres_password:/run/secrets/postgres_password:ro"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let postgres = def
        { image = "postgres:14.18"
        , environment = Just $ Map.fromList
            [ ("POSTGRES_DB", "eth")
            , ("POSTGRES_PASSWORD_FILE", "/run/secrets/postgres_password")
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec docker-entrypoint.sh postgres -c max_connections=300 -c shared_buffers=512MB >> /logs/postgres.log 2>&1"]
        , volumes = Just ["./logs:/logs", "pgdata:/var/lib/postgresql/data", "./secrets/postgres_password:/run/secrets/postgres_password:ro"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let nginx = def
        { image = "${NGINX_IMAGE:-" ++ repoUrl ++ "nginx:" ++ stratoVersion ++ "-" ++ hashNginx ++ "}"
        , build = Just "."
        , depends_on = Just ["apex", "docs", "postgrest", "prometheus", "smd", "strato", "mercata-backend", "mercata-ui"]
        , environment = Just $ Map.fromList
            [ ("APEX_HOST", "${APEX_HOST}")
            , ("blockTime", "${blockTime}")
            , ("DOCS_HOST", "${DOCS_HOST}")
            , ("NGINX_TRUST_PROXY_CIDRS", "${NGINX_TRUST_PROXY_CIDRS}")
            , ("OAUTH_CLIENT_ID", "${OAUTH_CLIENT_ID}")
            , ("OAUTH_CLIENT_SECRET", "${OAUTH_CLIENT_SECRET}")
            , ("OAUTH_DISCOVERY_URL", "${OAUTH_DISCOVERY_URL}")
            , ("OAUTH_SCOPE", "${OAUTH_SCOPE}")
            , ("POSTGREST_HOST", "${POSTGREST_HOST}")
            , ("PROMETHEUS_HOST", "${PROMETHEUS_HOST:-prometheus:9090}")
            , ("SERVE_LOGS", "${SERVE_LOGS}")
            , ("SMD_DEV_MODE", "${SMD_DEV_MODE}")
            , ("SMD_DEV_MODE_HOST_IP", "${SMD_DEV_MODE_HOST_IP}")
            , ("SMD_HOST", "${SMD_HOST}")
            , ("ssl", "${ssl}")
            , ("sslCertFileType", "${sslCertFileType}")
            , ("STATS_ENABLED", "${STATS_ENABLED}")
            , ("STRATO_HOSTNAME", "${STRATO_HOSTNAME:-strato}")
            , ("STRATO_PORT_API", "${STRATO_PORT_API:-3000}")
            , ("STRATO_PORT_API2", "${STRATO_PORT_API2}")
            , ("STRATO_PORT_LOGS", "${STRATO_PORT_LOGS}")
            , ("STRATO_PORT_VAULT_PROXY", "${STRATO_PORT_VAULT_PROXY:-8013}")
            , ("VAULT_URL", "${VAULT_URL}")
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec /docker-run.sh >> /logs/nginx.log 2>&1"]
        , ports = Just ["${HTTP_PORT:-80}:80", "${HTTPS_PORT:-443}:443"]
        , volumes = Just ["./logs:/logs", "./ssl:/tmp/ssl:ro"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let docs = def
        { image = "swaggerapi/swagger-ui:v5.29.2"
        , environment = Just $ Map.fromList
            [ ("API_URL", "/docs/swagger.yaml")
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec /docker-entrypoint.sh nginx -g 'daemon off;' >> /logs/docs.log 2>&1"]
        , volumes = Just ["./logs:/logs"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let zookeeper = def
        { image = "zookeeper:3.9.3"
        , environment = Just $ Map.fromList
            [ ("ZOO_DATA_LOG_DIR", "/data")
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec /docker-entrypoint.sh zkServer.sh start-foreground >> /logs/zookeeper.log 2>&1"]
        , volumes = Just ["./logs:/logs", "zookeeperdata:/data"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let kafka = def
        { image = "registry-aws.blockapps.net:5000/blockapps-repo/kafka:2.12-2.0.1"
        , depends_on = Just ["zookeeper"]
        , environment = Just $ Map.fromList
            [ ("KAFKA_ADVERTISED_HOST_NAME", "kafka")
            , ("KAFKA_ADVERTISED_PORT", "9092")
            , ("KAFKA_ZOOKEEPER_CONNECT", "zookeeper:2181")
            , ("KAFKA_DELETE_TOPIC_ENABLE", "true")
            , ("KAFKA_LOG_CLEANER_ENABLE", "true")
            , ("KAFKA_LOG_DIRS", "/kafka/kafka-logs")
            , ("KAFKA_LOG_RETENTION_HOURS", "168")
            , ("KAFKA_OFFSET_METADATA_MAX_BYTES", "1048576")
            , ("KAFKA_OFFSETS_RETENTION_MINUTES", "2147483647")
            , ("KAFKA_MAX_REQUEST_SIZE", "${KAFKA_MAX_REQUEST_SIZE:-2500000}")
            , ("KAFKA_MESSAGE_MAX_BYTES", "${KAFKA_MESSAGE_MAX_BYTES:-2500000}")
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec start-kafka.sh >> /logs/kafka.log 2>&1"]
        , volumes = Just ["./logs:/logs", "kafkadata:/kafka"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let prometheus = def
        { image = "${PROMETHEUS_IMAGE:-" ++ repoUrl ++ "prometheus:" ++ stratoVersion ++ "-" ++ hashPrometheus ++ "}"
        , build = Just "."
        , environment = Just $ Map.fromList
            [ ("NODE_HOST", "${NODE_HOST}")
            , ("STRATO_HOSTNAME", "${STRATO_HOSTNAME:-strato}")
            ]
        , entrypoint = Just ["/bin/sh", "-c"]
        , command = Just ["exec /entrypoint.sh >> /logs/prometheus.log 2>&1"]
        , volumes = Just ["./logs:/logs", "prometheusdata:/prometheus"]
        , restart = Just "unless-stopped"
        , logging = noLogging
        }

  let composeFile = ComposeFile
        { namedVolumes = topLevelVolumes
        , services = Map.fromList
            [ ("mercata-backend", mercataBackend)
            , ("mercata-ui", mercataUi)
            , ("smd", smd)
            , ("apex", apex)
            , ("redis", redis)
            , ("strato", strato)
            , ("postgrest", postgrest)
            , ("postgres", postgres)
            , ("nginx", nginx)
            , ("docs", docs)
            , ("zookeeper", zookeeper)
            , ("kafka", kafka)
            , ("prometheus", prometheus)
            ]
        }

  BS.putStr $ Yaml.encode composeFile
  hPutStrLn stderr "  ✓ Generated docker-compose.yml (allDocker)"
