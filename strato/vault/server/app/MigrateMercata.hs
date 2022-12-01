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
  _ <- $initHFlags "mercata-migrate"
  putStrLn "Usage: mercata-migrate --pw=<vault_password>  pwOld=<vault_password> --index to start at?"
  
  let dbConnectInfo = ConnectInfo { connectHost     = "postgres"
                                  , connectPort     = 5432
                                  , connectUser     = "postgres"
                                  , connectPassword = "api"
                                  , connectDatabase = "oauth"
                                  }
  conn <- connect dbConnectInfo
  

  let pw             = VC.textPassword $ T.pack flags_pw
  let pwOld          = VC.textPassword $ T.pack flags_pwOld
  let indexToStartAt = (fromIntegral flags_indexToStartAt) :: Int32
  
  
  (mMsgLst :: [(B.ByteString, SB.Nonce, B.ByteString)]) <- runSelect conn VQ.getMessageQueryAll
  let [(_, _, _), (globaOldSalt, _, _)] = mMsgLst -- make this a case statement that throws an error if not two tripules
  
  pwKey <- case mMsgLst of
    [] -> error "message table is empty, so the password must not be set. Aborting..."
    [(msgSalt, msgNonce, ciphertext), (_,_,_)] -> do
      let key = VP.getKeyFromPasswordAndSalt pw msgSalt
      case VC.decrypt key msgNonce ciphertext of
        Just msg | msg == VP.superSecretVaultWrapperMessage -> pure key
        _ -> error "couldn't decrypt the secret message, probably you entered the wrong vault password"
    _ -> error ("Not right number of  rows in message table, something is not right" ++ (show  $ length mMsgLst ))
  
  allUsers <- getUsersQuery conn --Also drop all without index of--- Needs to take an index arguement

  let reencrypt ::   Int32 -> B.ByteString -> SB.Nonce -> B.ByteString -> Maybe (B.ByteString, Int32)
      reencrypt  i _ nonce encKey = do
          let sbKey     =  VP.getKeyFromPasswordAndSalt pwOld globaOldSalt
          decKey        <- VC.decryptSecKey sbKey nonce encKey
          let newEncKey =  VC.encrypt pwKey nonce (exportPrivateKey decKey)
          -- let newEncKey =  VC.encrypt pwKey nonce (exportPrivateKey decKey) -- Won't we use the new table 
          pure (newEncKey, i)

  let allIdsAndNewEncKeys = catMaybes $  map (\(i, s, n, k) -> reencrypt i s n k) allUsers

  let idsAndNewEncKeys = filter (\(_, i) -> i > indexToStartAt) allIdsAndNewEncKeys

  putStrLn $ (show $ length idsAndNewEncKeys) ++ " of those keys can be reencrypted"
  putStrLn $ "\nFound " ++ (show $ length allUsers) ++ " keys"


    
  rowsChanged <- return . sum =<< mapM (\(newKey, rowId) -> runUpdate_ conn $ Update
                                   { uTable = usersTable
                                   , uUpdateWith = updateEasy (set _5 (toFields newKey))
                                   , uWhere = views _1 (.== toFields rowId)
                                   , uReturning = rCount
                                   }) idsAndNewEncKeys

  putStrLn $ "ok, done. I updated " ++ (show rowsChanged) ++ " keys"


