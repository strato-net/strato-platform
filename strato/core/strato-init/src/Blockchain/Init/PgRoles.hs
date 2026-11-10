{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Init.PgRoles (pgInitSecrets, rolePassword, writePgInitFiles, writeRolePasswords, writeSecretFile) where

import Blockchain.Init.BuildMetadata.TH (embedRepoFile)
import Crypto.Hash.Algorithms (SHA256)
import Crypto.MAC.HMAC (HMAC, hmac)
import Data.ByteArray (convert)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Char8 as BSC
import Numeric (showHex)
import System.Directory (createDirectoryIfMissing, doesFileExist, renameFile)
import System.FilePath ((</>), takeDirectory)
import System.IO (openTempFile, hPutStr, hClose)
import System.Posix.Files (ownerReadMode, setFileMode)

roles :: [String]
roles = ["eth", "cirrus", "apex", "app", "postgrest", "auth", "vault", "history"]

-- | The files in secrets/ that pg-init reads.
pgInitSecrets :: [FilePath]
pgInitSecrets = "postgres_password" : [ "pg_" ++ role ++ "_password" | role <- roles ]

rolePassword :: String -> IO String
rolePassword role = readFile ("secrets" </> ("pg_" ++ role ++ "_password"))

-- All tiers given the same admin secret derive the same independent login
-- passwords. A runtime password cannot be used to recover the admin secret.
writeRolePasswords :: Bool -> IO ()
writeRolePasswords replace = do
  admin <- filter (/= '\n') <$> readFile ("secrets" </> "postgres_password")
  mapM_ (writeRolePassword admin) roles
  where
    writeRolePassword admin role = do
      let path = "secrets" </> ("pg_" ++ role ++ "_password")
      exists <- doesFileExist path
      if exists && not replace then setFileMode path ownerReadMode else do
        let mac = convert (hmac (BSC.pack admin) (BSC.pack ("STRATO PostgreSQL role v1: " ++ role)) :: HMAC SHA256) :: BS.ByteString
            password = concatMap (\b -> let hex = showHex b "" in if length hex == 1 then '0' : hex else hex) (BS.unpack mac)
        writeSecretFile path password

-- | The provisioning script and its SQL: the pg-init container runs them from
-- the node directory, in the stock postgres image.
writePgInitFiles :: IO ()
writePgInitFiles = do
  createDirectoryIfMissing True "pg-init"
  mapM_ (\(name, contents) -> writeFile ("pg-init" </> name) contents)
    [ ("pg-init.sh", $(embedRepoFile "strato/core/strato-init/pg-init/pg-init.sh"))
    , ("pg-roles.sql", $(embedRepoFile "strato/core/strato-init/pg-init/pg-roles.sql"))
    , ("pg-migrate-schema.sql", $(embedRepoFile "strato/core/strato-init/pg-init/pg-migrate-schema.sql"))
    ]

writeSecretFile :: FilePath -> String -> IO ()
writeSecretFile path value = do
  (tmp, handle) <- openTempFile (takeDirectory path) "strato-secret.tmp"
  hPutStr handle value
  hClose handle
  setFileMode tmp ownerReadMode
  renameFile tmp path
