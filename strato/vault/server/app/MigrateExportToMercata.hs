{-# LANGUAGE Arrows              #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE QuasiQuotes         #-}

import           Control.Arrow
import           Control.Lens.Combinators

import qualified Crypto.Saltine.Core.SecretBox      as SB
import qualified Data.ByteString                    as B
import           Data.Int                           (Int32)
import           Data.Maybe
import qualified Data.Text                          as T
import           Database.PostgreSQL.Simple         hiding (Query)
import           Opaleye                            hiding (sum)

import           Blockchain.Strato.Model.Secp256k1
import qualified Strato.Strato23.Crypto             as VC
import           Strato.Strato23.Database.Queries   as VQ
import           Strato.Strato23.Database.Tables
import qualified Strato.Strato23.Server.Password    as VP
import           HFlags
import           Options


getUsersQuery :: Connection -> IO [(Int32, B.ByteString, SB.Nonce, B.ByteString)] 
getUsersQuery conn = runSelect conn $ proc () -> do
  (userId, _,  salt, nonce, encKey, _, _) <- selectTable usersTable -< ()
  returnA -< (userId, salt, nonce, encKey)


main :: IO () 
main = do
  _ <- $initHFlags "migrate-export-to-mercata"

  let usageMsg = "Usage: migrate-export-to-mercata --pw=<vault_password>  pwOld=<vault_password>"
  putStrLn usageMsg
  
  let dbConnectInfo = ConnectInfo { connectHost     = "postgres"
                                  , connectPort     = 5432
                                  , connectUser     = "postgres"
                                  , connectPassword = "api"
                                  , connectDatabase = "oauth"
                                  }
  conn <- connect dbConnectInfo
  let pwOld = VC.textPassword $ T.pack flags_pwOld
  
  
  (mMsgLst :: [(B.ByteString, SB.Nonce, B.ByteString)]) <- runSelect conn VQ.getMessageQuery
  let [(globalSalt, _, _)] = mMsgLst

  allUsers <- getUsersQuery conn

  let reencrypt :: B.ByteString -> Int32 -> B.ByteString -> SB.Nonce -> B.ByteString -> Maybe (B.ByteString, Int32)
      reencrypt salt i _ nonce encKey = do
          let sbKey     =  VP.getKeyFromPasswordAndSalt pwOld salt
          decKey        <- VC.decryptSecKey sbKey nonce encKey

          pure (exportPrivateKey decKey, i)


  let ml  = map (\(_, s, _, _) ->  VP.getKeyFromPasswordAndSalt pwOld s) allUsers
  putStrLn "SHow all decrypted keys: "
  putStrLn $ show $ map  (\( sbKey, (_, _, nonce, encKey))->  VC.decryptSecKey sbKey nonce encKey) (zip ml  allUsers)
  let maybeEncryptedKeys = map (\(i, s, n, k) -> reencrypt globalSalt i s n k) allUsers
  let idsAndNewEncKeys   = catMaybes $ maybeEncryptedKeys

  
  putStrLn $ (show $ length idsAndNewEncKeys) ++ " of those keys can be reencrypted"
  putStrLn $ "\nFound " ++ (show $ length allUsers) ++ " keys"


  rowsChanged <- return . sum =<< mapM (\(newKey, rowId) -> runUpdate_ conn $ Update
                                   { uTable = usersTable
                                   , uUpdateWith = updateEasy (set _5 (toFields newKey))
                                   , uWhere = views _1 (.== toFields rowId)
                                   , uReturning = rCount
                                   }) idsAndNewEncKeys

  putStrLn $ "ok, done. I updated " ++ (show rowsChanged) ++ " keys"