{-# LANGUAGE OverloadedStrings #-}

module Handler.Login where

import qualified Data.Text as T
import qualified Data.Text.Encoding as T


import Network.Wai
import Import
import Handler.Filters
import Handler.Common

import Crypto.BCrypt
import qualified Database.Esqueleto as E
import qualified Database.Persist.Sql as SQL

import qualified Prelude as P

postLoginR :: Handler Value
postLoginR = do
  addHeader "Access-Control-Allow-Origin" "*"
  
  maybeEmail <- lookupPostParam "email"
  maybeAppName <- lookupPostParam "app"
  maybeAddress <- lookupPostParam "address"
  maybeLoginPass <- lookupPostParam "loginpass"  

  emailDB <- case maybeEmail of 
    (Just email) -> return $ email
    Nothing -> invalidArgs ["Missing 'email'"]

  (_,appId) <- case maybeAppName of 
    (Just app) -> do appLookup <- runDB $ E.select $
                                        E.from $ \(a) -> do
                                        E.where_ (  a E.^. BlockAppName E.==. (E.val $ T.unpack app) E.&&.
                                                    a E.^. BlockAppVerified E.==. (E.val True) )
                                        E.limit $ 1 -- appnames are unique
                                        return a
                     case appLookup of
                            [] -> permissionDenied $ "app: " ++ app ++ " not registered"
                            x -> return (app,E.entityKey $ P.head x)
    Nothing -> invalidArgs ["Missing 'app'"]

  addressDB <- case maybeAddress of 
    (Just address) -> return $ address
    Nothing -> invalidArgs ["Missing 'address'"]

  userWallet <- case maybeLoginPass of 
    Nothing -> invalidArgs ["missing 'loginpass'"]
    (Just loginPass) -> do emailLookup <- runDB $ E.select $
                                        E.from $ \(u `E.LeftOuterJoin` ud) -> do
                                        E.on (u E.^. UserNId E.==. ud E.^. UserDataUserId)
                                        E.where_ ((u E.^. UserNEmail E.==. (E.val $ T.unpack emailDB)) E.&&.
                                                  (u E.^. UserNVerified E.==. (E.val $ True)) E.&&.
                                                  (ud E.^. UserDataAddress E.==. (E.val $ toAddr addressDB)))
                                        E.limit $ (1 :: Int64)
                                        E.orderBy [E.desc (u E.^. UserNNumLogins)]
                                        return u

                           case emailLookup of
                             [] -> do permissionDenied $ "invalid email or password or address" 
                             x -> do now <- liftIO $ getCurrentTime --- todo, add last attempted login
                                     let userEnt = P.head x
                                         user = E.entityVal $ userEnt
                                         userKey = E.entityKey $ userEnt
                                         numLogins = userNNumLogins $ user
                                         passHash = userNLoginPassHash $ user 
                                         valid = validatePassword passHash (T.encodeUtf8 loginPass)

                                     case valid of 
                                       False -> permissionDenied $ "invalid email or password or address"
                                       True  -> do _ <- runDB $ SQL.update userKey [ UserNLastLogin SQL.=. now,
                                                                                         UserNNumLogins SQL.=. (numLogins+1) ]
                                                   ip <- fmap (show . remoteHost . reqWaiRequest) getRequest
                                                   _ <- runDB $ E.insert $ BlockAppLogin { 
                                                                        blockAppLoginUserId = userKey,
                                                                        blockAppLoginBlockAppId = appId,
                                                                        blockAppLoginTimestamp = now,
                                                                        blockAppLoginIp = show ip
                                                                      }
                                                   userLookup <- runDB $ E.select $ E.from $ \(u `E.LeftOuterJoin` ud) -> do
                                                                     E.on (u E.^. UserNId E.==. ud E.^. UserDataUserId)
                                                                     E.where_ ((u E.^. UserNEmail E.==. (E.val $ T.unpack emailDB)) E.&&.
                                                                               (u E.^. UserNVerified E.==. (E.val $ True)) E.&&.
                                                                               (ud E.^. UserDataAddress E.==. (E.val $ toAddr addressDB)))
                                                                   
                                                                     E.limit $ (1 :: Int64)
                                                                     E.orderBy [E.desc (u E.^. UserNNumLogins)]
                                                                     return ud
                       
                                                   return  userLookup
   
--  sendResponse $ addressDB1
  returnJson . E.entityVal . P.head  $ userWallet


