{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}


import           Crypto.Random.Entropy
import qualified Crypto.Saltine.Core.SecretBox      as SB
import           Database.PostgreSQL.Simple
import qualified Data.ByteString.Base64             as B64
import qualified Data.ByteString.Char8              as C8
import           Data.Either
import           Data.Maybe
import qualified Data.Text                          as T


import           Blockchain.ECDSA
import           Blockchain.Strato.Model.Address
import qualified Strato.Strato23.Crypto             as VC
import qualified Strato.Strato23.Database.Queries   as VQ
import           Options
import           HFlags


-- usage: migrate-nodekey --pw=<vault_password> --key=<nodekey_to_insert>

main :: IO ()
main = do
  _ <- $initHFlags "migrate-nodekey"
  let dbConnectInfo = ConnectInfo { connectHost     = "postgres"
                                  , connectPort     = 5432
                                  , connectUser     = "postgres"
                                  , connectPassword = "api"
                                  , connectDatabase = "oauth"
                                  }
  conn <- connect dbConnectInfo
 
  let bytes = fromRight (error "invalid base64 key") . B64.decode . C8.pack $ flags_key
      pkey = fromMaybe (error "could not import sec key") . importPrivateKey $ bytes
      pw = VC.textPassword $ T.pack flags_pw
      testKeyBS = C8.unpack $ B64.encode $ exportPrivateKey pkey

  putStrLn $ "here is the key I will insert: " ++ testKeyBS
  -- create keystore
  salt <- getEntropy 16
  nonce <- SB.newNonce
  let encAcctSk = VC.encrypt pw salt nonce $ exportPrivateKey pkey
      acctAddr = fromPrivateKey pkey
      acctPubKey = derivePublicKey pkey
      keystore = VC.KeyStore { VC.keystoreSalt = salt
                             , VC.keystoreAcctNonce = nonce
                             , VC.keystoreAcctEncSecKey = encAcctSk
                             , VC.keystoreAcctAddress = acctAddr
                             , VC.keystoreAcctPubKey = acctPubKey
                             }
  
  success <- VQ.postUserKeyQuery (T.pack "nodekey") keystore conn
  if success then
    putStrLn "success"
  else
    putStrLn "failure"

