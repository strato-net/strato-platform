module Blockchain.Init.LocalAuth
  ( setupLocalAuthSecrets
  ) where

import Control.Monad (unless, void)
import qualified Data.ByteString as BS
import System.Environment (lookupEnv)
import System.Entropy (getEntropy)
import System.FilePath ((</>))
import Turtle (chmod, roo)
import UnliftIO.Directory (doesFileExist)

setupLocalAuthSecrets :: IO ()
setupLocalAuthSecrets = do
  setupGeneratedSecret "vault_password" "vault password" "vault_password" 32
  setupGeneratedSecret "local_auth_hydra_system_secret" "local-auth Hydra system secret" "LOCAL_AUTH_HYDRA_SYSTEM_SECRET" 64
  setupGeneratedSecret "local_auth_hydra_pairwise_salt" "local-auth Hydra pairwise salt" "LOCAL_AUTH_HYDRA_PAIRWISE_SALT" 64
  setupGeneratedSecret "local_auth_kratos_cookie_secret" "local-auth Kratos cookie secret" "LOCAL_AUTH_KRATOS_COOKIE_SECRET" 64

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
