{-# LANGUAGE OverloadedStrings #-}

module Handler.RegisterApp where

import Import
import Handler.Common

import qualified Data.ByteString.Base16 as B16
import qualified Data.Text as T
import qualified Data.Text.Encoding as T

import Data.Text.Lazy.Encoding
import Text.Shakespeare.Text
import Text.Blaze
import Text.Blaze.Html.Renderer.Text (renderHtml)
import Text.Julius
import Crypto.BCrypt
import qualified Network.Mail.Mime as M
import System.Entropy

import qualified Database.Esqueleto as E
import qualified Database.Persist.Sql as SQL

import qualified Prelude as P

sendMailDev :: (ToText a, ToMarkup a, MonadIO m) 
            => Text -> a -> m ()
sendMailDev email verurl =  liftIO $ M.renderSendMail (M.emptyMail $ M.Address Nothing "noreply")
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
                    <p>Thank you
                |]
            , M.partHeaders = []
            }

getRegisterAppR :: Handler Html
getRegisterAppR = do
  maybeVerkey <- lookupGetParam "p"
  appEnt <- case maybeVerkey of 
    Nothing -> invalidArgs ["Missing 'not registered'"]
    Just verkey -> do appLookup <-  runDB $ E.select $
                                        E.from $ \(a) -> do
                                        E.where_ (  a E.^. BlockAppVerkey E.==. (E.val . fst . B16.decode . T.encodeUtf8 $ verkey))
                                        E.limit $ 1 -- appnames are unique
                                        return a
                      _ <- runDB $ SQL.update (E.entityKey . P.head $ appLookup) [ BlockAppVerified SQL.=. True ]
                      return appLookup

  let app = E.entityVal . P.head $ appEnt
      appName = blockAppName $ app
      developer = blockAppDeveloperName $ app
      url = blockAppAppUrl $ app      

  defaultLayout $(widgetFile "appRegister")
  
    

postRegisterAppR :: Handler Text
postRegisterAppR = do
  addHeader "Access-Control-Allow-Origin" "*"
  
  maybeAppName <- lookupPostParam "app"
  maybeDeveloper <- lookupPostParam "developer"
  maybeEmail <- lookupPostParam "email"
  maybeAppUrl <- lookupPostParam "appurl"
  maybeRepoUrl <- lookupPostParam "repourl"
  maybeLoginPass <- lookupPostParam "loginpass"

  developerDB <- case maybeDeveloper of 
    (Just dev) -> return $ dev
    Nothing -> invalidArgs ["Missing 'developer'"]

  emailDB <- case maybeEmail of 
    (Just email) -> return $ email
    Nothing -> invalidArgs ["Missing 'email'"]

  appNameDB <- case maybeAppName of 
    (Just app) -> do appLookup <-  runDB $ E.select $
                                        E.from $ \(a) -> do
                                        E.where_ (  a E.^. BlockAppName E.==. (E.val $ T.unpack app))
                                        E.limit $ 1 -- appnames are unique
                                        return a
                     case appLookup of 
                       [] -> return app
                       _ -> permissionDenied $ "app: " ++ app ++ " already registered"
 
    Nothing -> invalidArgs ["Missing 'app'"]

  appUrlDB <- case maybeAppUrl of 
    (Just url) -> return $ url
    Nothing -> invalidArgs ["Missing 'appurl'"]

  
  pass <- case maybeLoginPass of 
          (Just loginPass) ->
             liftIO $ hashPasswordUsingPolicy slowerBcryptHashingPolicy { preferredHashCost = 10 } 
                                              (T.encodeUtf8 loginPass)
          Nothing -> invalidArgs ["Missing 'loginpass'"]
  _ <- case pass of 
               (Just pass') -> do
                   verkey <- liftIO $ getEntropy 64
                   _ <- runDB $ E.insert $ BlockApp { blockAppName = T.unpack $ appNameDB,
                                                 blockAppDeveloperName = T.unpack $ developerDB,
                                                 blockAppDeveloperEmail = T.unpack $ emailDB,
                                                 blockAppAppUrl = T.unpack $ appUrlDB,
                                                 blockAppRepoUrl = T.unpack <$> maybeRepoUrl,
                                                 blockAppLoginPassHash = pass',
                                                 blockAppVerified = False,
                                                 blockAppVerkey = verkey
                                                } 
                   root <- appRoot . appSettings <$> getYesod
                   sendMailDev emailDB ("http://" ++ root ++ "/eth/v1.0/register?p=" ++ (T.decodeUtf8 $ B16.encode $ verkey)) -- probably shouldn't hardcode url
               Nothing -> permissionDenied $ "password failure"


  sendResponse $ appNameDB

