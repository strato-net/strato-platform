{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Options where

import Data.List (isPrefixOf)
import Data.Maybe (fromMaybe)
import Database.PostgreSQL.Simple (ConnectInfo (..))
import HFlags
import System.Environment (getArgs, lookupEnv)

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
--   1. CLI flag, if the operator passed it, whatever its value.
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
  args <- getArgs
  -- HFlags exposes a flag's value, not whether it was passed, so the
  -- arguments are checked: --name, an unambiguous prefix of it, or -c.
  let passed short long = any isFlag args
        where
          isFlag ('-' : '-' : rest) = let name = takeWhile (/= '=') rest in not (null name) && name `isPrefixOf` long
          isFlag ('-' : c : _) = Just c == short
          isFlag _ = False
      resolve envName flagVal isPassed
        | isPassed = pure flagVal
        | otherwise = fromMaybe flagVal . nonEmpty <$> lookupEnv envName
      nonEmpty (Just s) | not (null s) = Just s
      nonEmpty _ = Nothing
  host <- resolve "postgres_host" flags_pghost (passed (Just 'P') "pghost")
  portStr <- resolve "postgres_port" flags_pgport (passed Nothing "pgport")
  user <- resolve "postgres_user" flags_pguser (passed (Just 'u') "pguser")
  passwordEnv <- lookupEnv "postgres_password"
  passfile <- lookupEnv "PGPASSFILE"
  let pw = case (nonEmpty passwordEnv, nonEmpty passfile) of
        _ | passed (Just 'p') "password" -> flags_password
        (Just s, _) -> s
        (_, Just _) -> ""
        _ -> flags_password
  db <- resolve "postgres_vault_wrapper_db" flags_database (passed (Just 'd') "database")
  pure
    ConnectInfo
      { connectHost = host,
        connectPort = read portStr,
        connectUser = user,
        connectPassword = pw,
        connectDatabase = db
      }
