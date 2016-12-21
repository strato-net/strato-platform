{-# LANGUAGE OverloadedStrings #-}

module Handler.Wallet where


import Import
import Handler.Common
import Handler.Filters

import qualified Data.Text as T
import qualified Data.Text.Encoding as T

import Crypto.BCrypt

import System.Entropy
import Network.Wai
import Data.Text.Lazy.Encoding
import Text.Shakespeare.Text
import Text.Blaze 
import Text.Blaze.Html.Renderer.Text --(renderHtml)
import qualified Network.Mail.Mime as M

import qualified Data.Aeson as J
import qualified Data.ByteString.Base16 as B16
import qualified Database.Esqueleto as E
import qualified Database.Persist.Sql as SQL

import qualified Prelude as P

sendMailNewUser :: (ToText a1, ToText a, ToMarkup a1, ToMarkup a, MonadIO m) 
                => Text -> a1 -> a -> m ()
sendMailNewUser email keyJsonString verurl =  liftIO $ M.renderSendMail (M.emptyMail $ M.Address Nothing "noreply")
            { M.mailTo = [M.Address Nothing email]
            , M.mailHeaders =
                [ ("Subject", "Verify your email address")
                ]
            , M.mailParts = [[textPart, htmlPart]]
            }
      where
        textPart = M.Part
            { M.partType = "text/plain; charset=utf-8"
            , M.partEncoding = M.None
            , M.partFilename = Nothing
            , M.partContent = Data.Text.Lazy.Encoding.encodeUtf8
                [stext|
                    Please confirm your email address by clicking on the link below.

                    #{verurl}

                    Your wallet is #{keyJsonString}.
                    Thank you
                |]
            , M.partHeaders = []
            }
        htmlPart = M.Part
            { M.partType = "text/html; charset=utf-8"
            , M.partEncoding = M.None
            , M.partFilename = Nothing
            , M.partContent = Data.Text.Lazy.Encoding.encodeUtf8 $ renderHtml
                [shamlet|
                    <p>Please confirm your email address by clicking on the link below.
                    <p>
                        <a href=#{verurl}>#{verurl}

                        Your wallet is #{keyJsonString}.
                    <p>Thank you
                |]
            , M.partHeaders = []
            }


sendMailNewWallet :: (ToText a, ToMarkup a, MonadIO m) 
                  => Text -> a -> m ()
sendMailNewWallet email keyJsonString =  liftIO $ M.renderSendMail (M.emptyMail $ M.Address Nothing "noreply")
            { M.mailTo = [M.Address Nothing email]
            , M.mailHeaders =
                [ ("Subject", "Verify your email address")
                ]
            , M.mailParts = [[textPart, htmlPart]]
            }
      where
        textPart = M.Part
            { M.partType = "text/plain; charset=utf-8"
            , M.partEncoding = M.None
            , M.partFilename = Nothing
            , M.partContent = Data.Text.Lazy.Encoding.encodeUtf8
                [stext|
                    Your new wallet is #{keyJsonString}.
                    Thank you
                |]
            , M.partHeaders = []
            }
        htmlPart = M.Part
            { M.partType = "text/html; charset=utf-8"
            , M.partEncoding = M.None
            , M.partFilename = Nothing
            , M.partContent = Data.Text.Lazy.Encoding.encodeUtf8 $ renderHtml
                [shamlet|
                    <p>Your new wallet is #{keyJsonString}.
                    <p>Thank you
                |]
            , M.partHeaders = []
            }


-- confirm by visiting, then redirect

getWalletR :: Handler Html
getWalletR = do
  maybeVerkey <- lookupGetParam "p"
  userEnt <- case maybeVerkey of 
    Nothing -> invalidArgs ["Missing 'user'"]
    Just verkey -> do userLookup <-  runDB $ E.select $
                                        E.from $ \(a) -> do
                                        E.where_ (  a E.^. UserNVerkey E.==. (E.val . fst . B16.decode . T.encodeUtf8 $ verkey))
                                        E.limit $ 1 -- appnames are unique
                                        return a
                      _ <- runDB $ SQL.update (E.entityKey . P.head $ userLookup) [ UserNVerified SQL.=. True ]
                      return userLookup

  let user = E.entityVal . P.head $ userEnt
      userEmail = userNEmail $ user
  
  defaultLayout $(widgetFile "userRegister")
  
-- creates the wallet or user identity
postWalletR :: Handler Value
postWalletR = do
  addHeader "Access-Control-Allow-Origin" "*"
 
  liftIO $ P.putStrLn $ "creating wallet"

  maybeEmail <- lookupPostParam "email"
  maybeAppName <- lookupPostParam "app"
  maybeAddress <- lookupPostParam "address"
  maybeEncKey <- lookupPostParam "enckey" -- key, assumed encrypted on the client side as in our libraries
  maybeLoginPass <- lookupPostParam "loginpass" -- needs to be salted and bcrypted

  emailDB <- case maybeEmail of 
    (Just email) -> return $ email
    Nothing -> invalidArgs ["Missing 'email'"]

  liftIO $ putStrLn $ "email for the database: " ++ emailDB
  liftIO $ P.putStrLn $ "about lookup address"  
  addressDB <- case maybeAddress of 
    (Just address) ->  do addressLookup <- runDB $ E.select $
                                        E.from $ \(ud) -> do
                                        E.where_ (  ud E.^. UserDataAddress E.==. (E.val $ toAddr address))
                                        E.limit $ 1 -- addresses are unique to a user
                                        return ud
                          case addressLookup of
                            [] -> return address
                            _ -> permissionDenied $ "address " ++ address ++ " already exists"
   
    Nothing -> invalidArgs ["Missing 'address'"]

  liftIO $ P.putStrLn $ "about lookup app"  
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
           -- check if app exists
    Nothing -> invalidArgs ["Missing 'app'"]

  encKeyDB <- case maybeEncKey of 
    (Just encKey) -> return $ encKey
    Nothing -> invalidArgs ["Missing 'enckey'"]

  -- allow users to have multiple keys and associated apps, but only one email and password
  liftIO $ P.putStrLn $ "about to register user and pass"  
  newUser <- case maybeLoginPass of 
    Nothing -> invalidArgs ["missing 'loginpass'"]
    (Just loginPass) -> do emailLookup <- runDB $ E.select $
                                        E.from $ \(u) -> do
                                        E.where_ ((u E.^. UserNEmail E.==. (E.val $ T.unpack emailDB)))
                                        E.limit $ (1 :: Int64)
                                        E.orderBy [E.desc (u E.^. UserNNumLogins)]
                                        return u
                           case emailLookup of
                             [] -> do liftIO $ P.putStrLn $ "email not found, registering"
                                      now <- liftIO $ getCurrentTime
                                      pass <- liftIO $ hashPasswordUsingPolicy slowerBcryptHashingPolicy { preferredHashCost = 10 } 
                                                                                (T.encodeUtf8 loginPass)
                                      liftIO $ P.putStrLn $ "hashed password"
                                      verkey <- liftIO $ getEntropy 64
                                      userEnt <- case pass of 
                                               (Just pass') -> do
                                                    liftIO $ P.putStrLn $ "registering user with entropy"
                                                    runDB $ E.insert $ UserN { 
                                                                              userNEmail = T.unpack $ emailDB,
                                                                              userNLoginPassHash = pass',
                                                                              userNLastLogin = now,
                                                                              userNNumLogins = 0, 
                                                                              userNVerified = False, 
                                                                              userNVerkey = verkey }
                                                
                                               Nothing -> permissionDenied $ "password failure"
                                      liftIO $ P.putStrLn $ "inserted user"
                                      let userData = UserData { 
                                                                userDataEncryptedWallet = T.unpack $ encKeyDB,
                                                                userDataAddress = toAddr addressDB,
                                                                userDataUserId = userEnt 
                                                              }
                                      _ <- runDB $ E.insert $ userData
                                      liftIO $ P.putStrLn $ "inserted user data"
                                      ip <- fmap (show . remoteHost . reqWaiRequest) getRequest
                                      _ <- runDB $ E.insert $ BlockAppLogin { 
                                                                        blockAppLoginUserId = userEnt,
                                                                        blockAppLoginBlockAppId = appId,
                                                                        blockAppLoginTimestamp = now,
                                                                        blockAppLoginIp = show ip
                                                                      } 
                                      liftIO $ P.putStrLn $ "inserted login data"
                                      root <- appRoot . appSettings <$> getYesod
                                      sendMailNewUser emailDB (show $ J.encode userData) (root ++ "/eth/v1.0/wallet?p=" ++ (T.decodeUtf8 $ B16.encode $ verkey)) 
                                      return $ userData      

                             -- no need to register
                             x -> do now <- liftIO $ getCurrentTime
                                     let userEnt = P.head x
                                         user = E.entityVal $ userEnt
                                         userKey = E.entityKey $ userEnt
                                         numLogins = userNNumLogins $ user
                                         passHash = userNLoginPassHash $ user 
                                         valid = validatePassword passHash (T.encodeUtf8 loginPass)
                                         userData = UserData { 
                                                               userDataEncryptedWallet = T.unpack $ encKeyDB,
                                                               userDataAddress = toAddr addressDB,
                                                               userDataUserId = userKey
                                                             }

                                     case valid of 
                                       False -> permissionDenied $ "invalid email or password"
                                       True  -> do _ <- runDB $ SQL.update userKey [ UserNLastLogin SQL.=. now,
                                                                                         UserNNumLogins SQL.=. (numLogins+1) ]
                                                   _ <- runDB $ E.insert $ userData
                                                   ip <- fmap (show . remoteHost . reqWaiRequest) getRequest
                                                   _  <- runDB $ E.insert $ BlockAppLogin { 
                                                                        blockAppLoginUserId = userKey,
                                                                        blockAppLoginBlockAppId = appId,
                                                                        blockAppLoginTimestamp = now,
                                                                        blockAppLoginIp = show ip
                                                                      }
                                                   sendMailNewWallet emailDB (show $ J.encode userData) 
                                                   return $ userData
   
--  sendResponse $ addressDB1
  returnJson $ newUser
