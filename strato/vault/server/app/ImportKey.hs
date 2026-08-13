{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.Strato.Model.Address (formatAddressWithoutColor, fromPrivateKey, stringAddress)
import Blockchain.Strato.Model.Secp256k1
import qualified Crypto.Saltine.Core.SecretBox as SB
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
import Data.Char (isSpace)
import qualified Data.Text as T
import Database.PostgreSQL.Simple
import HFlags
import Opaleye.RunSelect
import Options
import qualified Strato.Strato23.Crypto as VC
import qualified Strato.Strato23.Database.Queries as VQ
import qualified Strato.Strato23.Server.Password as VP
import System.Exit (die, exitSuccess)
import Control.Monad (unless, when)

main :: IO ()
main = do
  _ <- $initHFlags "strato-vault-import-key"
  privateKeyHex <- filter (not . isSpace) <$> getContents
  privateKey <- decodePrivateKey privateKeyHex
  validateExpectedAddress privateKey
  when flags_printAddress $ do
    putStrLn $ formatAddressWithoutColor $ fromPrivateKey privateKey
    exitSuccess
  vaultPassword <- readVaultPassword
  postgresPassword <- readPostgresPassword

  conn <- connect $ dbConnectInfo postgresPassword
  (mMsgLst :: [(B.ByteString, SB.Nonce, B.ByteString)]) <- runSelect conn VQ.getMessageQuery
  case mMsgLst of
    [] -> die "message table is empty, so the vault password must not be set. Aborting..."
    [(msgSalt, msgNonce, ciphertext)] -> do
      let key = VP.getKeyFromPasswordAndSalt (VC.textPassword $ T.pack vaultPassword) msgSalt
      case VC.decrypt key msgNonce ciphertext of
        Just msg | msg == VP.superSecretVaultWrapperMessage -> do
          keyStore <- VC.keyStoreFromPrivateKey key privateKey
          success <- VQ.postUserKeyQuery' (T.pack flags_username) (T.pack flags_oauthProvider) keyStore conn
          if success
            then putStrLn $ "Imported key for " ++ flags_username ++ " (" ++ flags_oauthProvider ++ "): " ++ show (VC.keystoreAcctAddress keyStore)
            else die $ "User key already exists for " ++ flags_username ++ " (" ++ flags_oauthProvider ++ ")"
        _ -> die "couldn't decrypt the secret message, probably you entered the wrong vault password"
    _ -> die "multiple rows in message table, something is not right"

dbConnectInfo :: String -> ConnectInfo
dbConnectInfo postgresPassword =
  ConnectInfo
    { connectHost = flags_pghost,
      connectPort = read flags_pgport,
      connectUser = flags_pguser,
      connectPassword = postgresPassword,
      connectDatabase = flags_database
    }

readVaultPassword :: IO String
readVaultPassword
  | not (null flags_vaultPasswordFile) = filter (/= '\n') <$> readFile flags_vaultPasswordFile
  | not (null flags_pw) = return flags_pw
  | otherwise = die "Pass --vaultPasswordFile or --pw"

readPostgresPassword :: IO String
readPostgresPassword
  | not (null flags_postgresPasswordFile) = filter (`notElem` ['\r', '\n']) <$> readFile flags_postgresPasswordFile
  | otherwise = pure flags_password

decodePrivateKey :: String -> IO PrivateKey
decodePrivateKey privateKeyHex = do
  bytes <- case B16.decode $ C8.pack privateKeyHex of
    Left err -> die $ "Invalid private key hex: " ++ err
    Right decoded -> return decoded
  maybe (die "Invalid secp256k1 private key") return $ importPrivateKey bytes

validateExpectedAddress :: PrivateKey -> IO ()
validateExpectedAddress privateKey
  | null flags_expectedAddress = return ()
  | otherwise =
      case stringAddress flags_expectedAddress of
        Nothing -> die "Invalid --expectedAddress: expected a 20-byte hexadecimal address"
        Just expected -> do
          let actual = fromPrivateKey privateKey
          unless (actual == expected) $
            die $
              "Private key address "
                ++ formatAddressWithoutColor actual
                ++ " does not match --expectedAddress "
                ++ formatAddressWithoutColor expected
