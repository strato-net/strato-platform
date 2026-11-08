module Blockchain.Init.PgRoles (rolePassword, writeRolePasswords) where

import Crypto.Hash.Algorithms (SHA256)
import Crypto.MAC.HMAC (HMAC, hmac)
import Data.Bits ((.|.))
import Data.ByteArray (convert)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Char8 as BSC
import Numeric (showHex)
import System.Directory (doesFileExist)
import System.FilePath ((</>))
import System.Posix.Files (ownerReadMode, ownerWriteMode, groupReadMode, otherReadMode, setFileMode)

roles :: [String]
roles = ["eth", "cirrus", "apex", "app", "postgrest", "auth", "vault", "history"]

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
      if exists && not replace then pure () else do
        let mac = convert (hmac (BSC.pack admin) (BSC.pack ("STRATO PostgreSQL role v1: " ++ role)) :: HMAC SHA256) :: BS.ByteString
            password = concatMap (\b -> let hex = showHex b "" in if length hex == 1 then '0' : hex else hex) (BS.unpack mac)
        if exists then setFileMode path (ownerReadMode .|. ownerWriteMode) else pure ()
        writeFile path password
        setFileMode path (ownerReadMode .|. groupReadMode .|. otherReadMode)
