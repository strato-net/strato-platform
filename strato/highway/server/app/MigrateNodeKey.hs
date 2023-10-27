{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Secp256k1
import qualified Crypto.Saltine.Core.SecretBox as SB
import qualified Data.ByteString as B
import qualified Data.ByteString.Base64 as B64
import qualified Data.ByteString.Char8 as C8
import Data.Either
import Data.Maybe
import qualified Data.Text as T
import Database.PostgreSQL.Simple
import HFlags
import Opaleye.RunSelect
import Options
import qualified Strato.Strato23.Crypto as VC
import qualified Strato.Strato23.Database.Queries as VQ
import qualified Strato.Strato23.Server.Password as VP

-- usage: migrate-nodekey --pw=<vault_password> --key=<nodekey_to_insert>

main :: IO ()
main = do
  _ <- $initHFlags "migrate-nodekey"
  let dbConnectInfo =
        ConnectInfo
          { connectHost = "postgres",
            connectPort = 5432,
            connectUser = "postgres",
            connectPassword = "api",
            connectDatabase = "oauth"
          }
  conn <- connect dbConnectInfo

  let bytes = fromRight (error "invalid base64 key") . B64.decode . C8.pack $ flags_key
      pkey = fromMaybe (error "could not import sec key") . importPrivateKey $ bytes
      pw = VC.textPassword $ T.pack flags_pw
      testKeyBS = C8.unpack $ B64.encode $ exportPrivateKey pkey

  putStrLn $ "here is the key I will insert: " ++ testKeyBS

  -- lookup SecretBox.key in messages table to encrypt the key
  (mMsgLst :: [(B.ByteString, SB.Nonce, B.ByteString)]) <- runSelect conn VQ.getMessageQuery
  case mMsgLst of
    [] -> error "message table is empty, so the password must not be set. Aborting..."
    [(msgSalt, msgNonce, ciphertext)] -> do
      let key = VP.getKeyFromPasswordAndSalt pw msgSalt
      case VC.decrypt key msgNonce ciphertext of
        Just msg | msg == VP.superSecretVaultWrapperMessage -> do
          -- manually create the keystore
          (acctSalt, acctNonce) <- VC.newSaltAndNonce

          let encAcctSk = VC.encrypt key acctNonce $ exportPrivateKey pkey
              acctAddr = fromPrivateKey pkey
              keystore =
                VC.KeyStore
                  { VC.keystoreSalt = acctSalt, -- this is not used anymore
                    VC.keystoreAcctNonce = acctNonce,
                    VC.keystoreAcctEncSecKey = encAcctSk,
                    VC.keystoreAcctAddress = acctAddr
                  }

          success <- VQ.postUserKeyQuery (T.pack "nodekey") keystore conn
          if success
            then putStrLn "success"
            else putStrLn "failure"
        _ -> error "couldn't decrypt the secret message, probably you entered the wrong vault password"
    _ -> error "multiple rows in message table, something is not right"
