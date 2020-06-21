{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}


module Strato.Strato23.MigrateNodeKey (
    migrateNodeKey
) where




import           Crypto.Random.Entropy
import qualified Crypto.Saltine.Core.SecretBox      as SB
import           Crypto.Secp256k1
import           Database.PostgreSQL.Simple
import qualified Data.ByteString.Base64             as B64
import qualified Data.ByteString.Char8              as C8
import           Data.Either
import           Data.Maybe
import qualified Data.Text                          as T


import qualified Strato.Strato23.Crypto             as VC
import qualified Strato.Strato23.Database.Queries   as VQ


migrateNodeKey :: String -> String -> IO (PubKey)
migrateNodeKey pkey' pw'= do
  
  putStrLn "migrating nodekey to vault-wrapper...." 
  
  let dbConnectInfo = ConnectInfo { connectHost     = "postgres"
                                  , connectPort     = 5432
                                  , connectUser     = "postgres"
                                  , connectPassword = "api"
                                  , connectDatabase = "oauth"
                                  }


  conn <- connect dbConnectInfo
 
  let bytes = fromRight (error "invalid base64 key") . B64.decode . C8.pack $ pkey'
      pkey = fromMaybe (error "could not import sec key") . secKey $ bytes
      pw = VC.textPassword $ T.pack pw'
      testKeyBS = C8.unpack $ B64.encode $ getSecKey pkey

  putStrLn $ "here is the key I will insert: " ++ testKeyBS
  -- create keystore
  salt <- getEntropy 16
  nonce <- SB.newNonce
  let encAcctSk = VC.encrypt pw salt nonce $ getSecKey pkey
      acctAddr = VC.deriveAddress pkey
      acctPubKey = derivePubKey pkey
      keystore = VC.KeyStore { VC.keystoreSalt = salt
                             , VC.keystoreAcctNonce = nonce
                             , VC.keystoreAcctEncSecKey = encAcctSk
                             , VC.keystoreAcctAddress = acctAddr
                             , VC.keystoreAcctPubKey = acctPubKey
                             }
  
  success <- VQ.postUserKeyQuery (T.pack "nodekey") keystore conn
  if success then do
    putStrLn "success"
    return acctPubKey
  else
    error "failure"
