module Blockchain.Init.LocalAuth
  ( setupLocalAuthSecrets
  ) where

import Control.Monad (unless, void, when)
import qualified Data.ByteString as BS
import System.Environment (lookupEnv)
import System.Entropy (getEntropy)
import System.FilePath ((</>))
import System.IO (hFlush, hGetEcho, hSetEcho, stdin, stdout)
import Turtle (chmod, roo)
import UnliftIO.Directory (doesFileExist)

setupLocalAuthSecrets :: IO ()
setupLocalAuthSecrets = do
  setupGeneratedSecret "vault_password" "vault password" "vault_password" 32
  setupGeneratedSecret "local_auth_hydra_system_secret" "local-auth Hydra system secret" "LOCAL_AUTH_HYDRA_SYSTEM_SECRET" 64
  setupGeneratedSecret "local_auth_hydra_pairwise_salt" "local-auth Hydra pairwise salt" "LOCAL_AUTH_HYDRA_PAIRWISE_SALT" 64
  setupGeneratedSecret "local_auth_kratos_cookie_secret" "local-auth Kratos cookie secret" "LOCAL_AUTH_KRATOS_COOKIE_SECRET" 64
  setupAdminPassword

setupGeneratedSecret :: FilePath -> String -> String -> Int -> IO ()
setupGeneratedSecret fileName label envName len = do
  let path = "secrets" </> fileName
  exists <- doesFileExist path
  unless exists $ do
    envValue <- lookupEnv envName
    secret <- case envValue of
      Just value | not (null value) -> return value
      _ -> generatePassword len
    putStrLn $ "  Creating " ++ label ++ " file: " ++ path
    writeSecret path secret

setupAdminPassword :: IO ()
setupAdminPassword = do
  let path = "secrets" </> "local_auth_admin_password"
  exists <- doesFileExist path
  unless exists $ do
    envPassword <- lookupEnv "LOCAL_AUTH_ADMIN_PASSWORD"
    password <- case envPassword of
      Just value | not (null value) -> return value
      _ -> promptForAdminPassword
    validateAdminPassword password
    putStrLn $ "  Creating local-auth admin password file: " ++ path
    writeSecret path password

promptForAdminPassword :: IO String
promptForAdminPassword = do
  putStrLn ""
  putStrLn "Local auth setup"
  putStrLn "  Admin username: admin"
  password <- promptHidden "  Create admin password: "
  confirm <- promptHidden "  Confirm admin password: "
  when (password /= confirm) $
    fail "Admin passwords do not match"
  return password

promptHidden :: String -> IO String
promptHidden prompt = do
  putStr prompt
  hFlush stdout
  echo <- hGetEcho stdin
  hSetEcho stdin False
  value <- getLine
  hSetEcho stdin echo
  putStrLn ""
  return value

validateAdminPassword :: String -> IO ()
validateAdminPassword password =
  when (length password < 8) $
    fail "Admin password must be at least 8 characters"

writeSecret :: FilePath -> String -> IO ()
writeSecret path value = do
  writeFile path value
  void $ chmod roo path

generatePassword :: Int -> IO String
generatePassword len = do
  bytes <- getEntropy len
  return $ map toChar (BS.unpack bytes)
  where
    chars = ['a'..'z'] ++ ['A'..'Z'] ++ ['0'..'9']
    toChar b = chars !! (fromIntegral b `mod` length chars)
