{-# LANGUAGE OverloadedStrings #-}

module Handler.Developer where

import Import
import Handler.Common

import qualified Data.Text as T
import qualified Data.Text.Encoding as T

import Crypto.BCrypt
import qualified Database.Esqueleto as E

import qualified Prelude as P

postDeveloperR :: Handler Value
postDeveloperR = do
  addHeader "Access-Control-Allow-Origin" "*"
  
  maybeAppName <- lookupPostParam "app"
  maybeDeveloperEmail <- lookupPostParam "email"
  maybeLoginPass <- lookupPostParam "loginpass"  

  (emailDB,_) <- case maybeDeveloperEmail of 
    Nothing -> invalidArgs ["Missing 'email'"]
    (Just email) -> do emailLookup <- runDB $ E.select $
                                        E.from $ \(ap') -> do
                                        E.where_ ((ap' E.^. BlockAppDeveloperEmail E.==. (E.val $ T.unpack email)))
                                        E.limit $ (1 :: Int64)
                                        return ap'

                       let app' = E.entityVal . P.head $ emailLookup
                           password = blockAppLoginPassHash $ app'
                           loginPass = fromMaybe "" maybeLoginPass
                           valid = validatePassword password (T.encodeUtf8 loginPass)

                       case valid of 
                         False -> permissionDenied $ "invalid email or password" 
                         True -> return (email,password)                          

  (_,appId) <- case maybeAppName of 
    (Just app) -> do appLookup <- runDB $ E.select $
                                        E.from $ \(a) -> do
                                        E.where_ (  a E.^. BlockAppName E.==. (E.val $ T.unpack app) E.&&.
                                                    a E.^. BlockAppVerified E.==. (E.val True) E.&&.
                                                    a E.^. BlockAppDeveloperEmail E.==. (E.val $ T.unpack emailDB) )
                                        E.limit $ 1 -- appnames are unique
                                        return a
                     case appLookup of
                            [] -> permissionDenied $ "app: " ++ app ++ " not registered"
                            x -> return (app,E.entityKey $ P.head x)
    Nothing -> invalidArgs ["Missing 'app'"]

  logins <- do loginLookup <- runDB $ E.select $
                                        E.from $ \(l) -> do
                                        E.where_ (  l E.^. BlockAppLoginBlockAppId E.==. (E.val $ appId) )
                                        E.limit $ fetchLimit
                                        return l
               return loginLookup
    
  returnJson . (map E.entityVal) $ logins


