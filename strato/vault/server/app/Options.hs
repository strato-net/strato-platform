{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Options where

import Database.PostgreSQL.Simple (ConnectInfo (..))
import HFlags
import System.Environment (lookupEnv)

defineFlag "u:pguser" ("postgres" :: String) "Postgres user"
defineFlag "P:pghost" ("postgres" :: String) "Postgres hostname"
defineFlag "pgport" ("5432" :: String) "Postgres port"
defineFlag "p:password" ("api" :: String) "Postgres password"
defineFlag "postgresPasswordFile" ("" :: String) "Path to file containing Postgres password"
defineFlag "d:database" ("oauth" :: String) "Postgres database name"
defineFlag "port" (8000 :: Int) "The port which the server runs on"
defineFlag "keyStoreCacheTimeout" (60 :: Integer) "The number of seconds nonces are held in the global source code cache"
defineFlag "vaultPasswordFile" ("" :: String) "Path to file containing vault encryption password"
defineFlag "username" ("admin" :: String) "Username for key import"
defineFlag "oauthProvider" ("admin" :: String) "OAuth provider for key import"

defineFlag "pgPoolSize" (100 :: Int) "Maximum number of connections in the Postgres pool"
defineFlag "pgPoolIdleTimeout" (30 :: Int) "Idle connection timeout in seconds before pool closes connections"
defineFlag "pgPoolStripes" (0 :: Int) "Number of pool stripes (0 = use number of CPU capabilities)"

defineFlag "pw" ("" :: String) "Password for vault-proxy"
defineFlag "key" ("" :: String) "the old blockstanbulPrivateKey to migrate"
defineFlag "pwOld" ("" :: String) "Password for old vault-wrapper" -- Used for mercata migration
defineFlag "indexToStartAt" (1 :: Int) "The index in the postgres table to convert old decrypted to new decryption"

-- | Resolve Postgres connection settings using the following precedence:
--
--   1. CLI flag, if the operator passed a value different from the built-in
--      HFlags default (i.e. explicitly overrode it).
--   2. Environment variable (same names the vault-wrapper daemon reads from
--      docker-compose: @postgres_host@, @postgres_port@, @postgres_user@,
--      @postgres_password@, @postgres_vault_wrapper_db@), if set and non-empty.
--   3. @PGPASSFILE@ for the password, if set and non-empty. An empty password
--      lets libpq read the matching entry from that file.
--   4. The built-in HFlags default from 'Options'.
--
-- This follows CLI > env > passfile > default precedence while still
-- letting operators run the tool inside an existing vault-wrapper container
-- without re-typing connection settings that are already in its environment.
connectInfo :: IO ConnectInfo
connectInfo = do
  host <- resolve "postgres_host" flags_pghost "postgres"
  portStr <- resolve "postgres_port" flags_pgport "5432"
  user <- resolve "postgres_user" flags_pguser "postgres"
  passwordEnv <- lookupEnv "postgres_password"
  passfile <- lookupEnv "PGPASSFILE"
  let pw = case (flags_password, passwordEnv, passfile) of
        (s, _, _) | s /= "api" -> s
        (_, Just s, _) | not (null s) -> s
        (_, _, Just s) | not (null s) -> ""
        _ -> "api"
  db <- resolve "postgres_vault_wrapper_db" flags_database "oauth"
  pure
    ConnectInfo
      { connectHost = host,
        connectPort = read portStr,
        connectUser = user,
        connectPassword = pw,
        connectDatabase = db
      }
  where
    -- envName: env var name; flagVal: current HFlags value; flagDefault: the
    -- value HFlags would have had if the operator did not pass the flag.
    resolve :: String -> String -> String -> IO String
    resolve envName flagVal flagDefault
      | flagVal /= flagDefault = pure flagVal -- operator explicitly overrode via CLI
      | otherwise = do
          mEnv <- lookupEnv envName
          pure $ case mEnv of
            Just s | not (null s) -> s
            _ -> flagDefault
