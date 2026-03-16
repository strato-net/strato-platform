{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Init.DockerCompose (generateDockerCompose) where

import Prelude hiding (init)

import Blockchain.EthConf (ethConf)
import Blockchain.EthConf.Model (apiConfig, httpPort, ipAddress, urlConfig, vaultUrl)
import Blockchain.Init.ComposeTypes
import Blockchain.Init.DirHash (computeDirHash)
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
      portNum = show $ httpPort (apiConfig conf)
      nodeHost = "localhost:" ++ portNum
      stratoHostname = ipAddress (apiConfig conf)
      vault = vaultUrl (urlConfig conf)
      userGid = uid ++ ":" ++ gid

  let stdLogging = Just Logging
        { driver = "json-file"
        , options = Just LoggingOptions
            { max_size = Just "100m"
            , max_file = Just "3"
            }
        }

  let mercataBackend = def
        { image = "mercata-backend:" ++ stratoVersionTag ++ "-" ++ $(computeDirHash "mercata/backend")
        , depends_on = Just ["postgrest"]
        , init = Just True
        , volumes = Just ["./secrets/oauth_credentials.yaml:/run/secrets/oauth_credentials.yaml:ro"]
        , environment = Just $ Map.fromList
            [ ("NODE_URL", "http://nginx")
            , ("BASE_URL", "https://" ++ nodeHost)
            , ("STRATO_HOSTNAME", stratoHostname)
            ]
        , restart = Just "unless-stopped"
        , logging = stdLogging
        }

  let mercataUi = def
        { image = "mercata-ui:" ++ stratoVersionTag ++ "-" ++ $(computeDirHash "mercata/ui")
        , depends_on = Just ["mercata-backend"]
        , restart = Just "unless-stopped"
        , logging = stdLogging
        }

  let smd = def
        { image = "smd:" ++ stratoVersionTag ++ "-" ++ $(computeDirHash "smd-ui")
        , depends_on = Just ["apex", "postgrest", "prometheus"]
        , environment = Just $ Map.fromList
            [ ("NODE_HOST", nodeHost)
            , ("ssl", "false")
            ]
        , restart = Just "unless-stopped"
        , logging = stdLogging
        }

  let apex = def
        { image = "apex:" ++ stratoVersionTag ++ "-" ++ $(computeDirHash "apex")
        , depends_on = Just ["postgres", "prometheus"]
        , environment = Just $ Map.fromList
            [ ("postgres_host", "postgres")
            , ("postgres_port", "5432")
            , ("postgres_user", "postgres")
            , ("STRATO_HOSTNAME", stratoHostname)
            , ("STRATO_PORT_API", "3000")
            , ("STRATO_PORT_VAULT_PROXY", "8013")
            , ("vaultUrl", "http://nginx")
            ]
        , volumes = Just ["./secrets/postgres_password:/run/secrets/postgres_password:ro"]
        , restart = Just "unless-stopped"
        , logging = stdLogging
        }

  let redis = def
        { image = "redis:3.2"
        , user = Just userGid
        , command = Just ["redis-server", "--appendonly", "yes"]
        , restart = Just "unless-stopped"
        , healthcheck = Just Healthcheck
            { test = ["CMD", "redis-cli", "ping"]
            , interval = Just "2s"
            , timeout = Just "2s"
            , retries = Just 10
            }
        , logging = stdLogging
        , volumes = Just ["./redis:/data"]
        , ports = Just ["6379:6379"]
        }

  let postgrest = def
        { image = "postgrest:" ++ stratoVersionTag ++ "-" ++ $(computeDirHash "postgrest-packager")
        , depends_on = Just ["postgres"]
        , environment = Just $ Map.fromList
            [ ("blocHost", "strato:3000")
            , ("PG_ENV_POSTGRES_DB", "cirrus")
            , ("PG_ENV_POSTGRES_HOST", "postgres")
            , ("PG_ENV_POSTGRES_USER", "postgres")
            , ("PG_PORT_5432_TCP_PORT", "5432")
            , ("POSTGREST_LOG_LEVEL", "error")
            ]
        , volumes = Just ["./secrets/postgres_password:/run/secrets/postgres_password:ro"]
        , restart = Just "unless-stopped"
        , logging = stdLogging
        }

  let postgres = def
        { image = "postgres:14.18"
        , user = Just userGid
        , environment = Just $ Map.fromList
            [ ("POSTGRES_DB", "eth")
            , ("POSTGRES_PASSWORD_FILE", "/run/secrets/postgres_password")
            ]
        , volumes = Just
            [ "./postgres:/var/lib/postgresql/data"
            , "./secrets/postgres_password:/run/secrets/postgres_password:ro"
            ]
        , command = Just ["postgres", "-c", "max_connections=300", "-c", "shared_buffers=512MB"]
        , restart = Just "unless-stopped"
        , healthcheck = Just Healthcheck
            { test = ["CMD-SHELL", "pg_isready -U postgres"]
            , interval = Just "2s"
            , timeout = Just "2s"
            , retries = Just 10
            }
        , logging = stdLogging
        , ports = Just ["5432:5432"]
        }

  let nginx = def
        { image = "nginx:" ++ stratoVersionTag ++ "-" ++ $(computeDirHash "nginx-packager")
        , depends_on = Just ["apex", "docs", "postgrest", "prometheus", "smd", "mercata-backend", "mercata-ui"]
        , environment = Just $ Map.fromList
            [ ("STRATO_HOSTNAME", stratoHostname)
            , ("STRATO_PORT_API", "3000")
            , ("STRATO_PORT_VAULT_PROXY", "8013")
            , ("VAULT_URL", vault)
            ]
        , extra_hosts = Just ["host.docker.internal:host-gateway"]
        , ports = Just [portNum ++ ":80", "443:443"]
        , volumes = Just
            [ "./ssl:/tmp/ssl:ro"
            , "./secrets/oauth_credentials.yaml:/run/secrets/oauth_credentials.yaml:ro"
            ]
        , restart = Just "unless-stopped"
        , logging = stdLogging
        }

  let docs = def
        { image = "swaggerapi/swagger-ui:v5.29.2"
        , environment = Just $ Map.fromList [("API_URL", "/docs/swagger.yaml")]
        , restart = Just "unless-stopped"
        , logging = stdLogging
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
            }
        , volumes = Just ["./kafka:/kafka"]
        , logging = stdLogging
        , ports = Just ["9092:9092"]
        }

  let prometheus = def
        { image = "prometheus:" ++ stratoVersionTag ++ "-" ++ $(computeDirHash "prometheus-packager")
        , user = Just userGid
        , environment = Just $ Map.fromList
            [ ("NODE_HOST", nodeHost)
            , ("STRATO_HOSTNAME", stratoHostname)
            ]
        , volumes = Just ["./prometheus:/prometheus"]
        , restart = Just "unless-stopped"
        , logging = stdLogging
        }

  let composeFile = ComposeFile
        { services = Map.fromList
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
        }

  Yaml.encodeFile "docker-compose.yml" composeFile
