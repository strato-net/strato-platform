{-# LANGUAGE OverloadedStrings #-}

module Handler.AppCreate where

import Import
import Handler.Common
import qualified Data.Text as T
import qualified Data.Text.Encoding as T

getAppCreateR :: Handler Html
getAppCreateR = do
    (formWidget, formEnctype) <- generateFormPost appCreateForm

    defaultLayout $ do
        _ <- newIdent
        setTitle "BlockApps.net"
        $(widgetFile "appCreate")

postAppCreateR :: Handler Html
postAppCreateR = do
    ((result, _), _) <- runFormPost appCreateForm
    case result of
        FormSuccess app -> defaultLayout $ do
                                _ <- newIdent
                                setTitle "BlockApps.net"
                                $(widgetFile "appCreateSuccess")

        FormFailure f -> invalidArgs [T.pack $ "Invalid form submission: " ++ (show f)]
        FormMissing -> invalidArgs [T.pack $ "Form missing: "]


appCreateForm :: Html -> MForm Handler (FormResult BlockApp, Widget)
appCreateForm = renderDivs $ createBlockApp
    <$> areq textField "appname" Nothing
    <*> areq textField "developer" Nothing
    <*> areq emailField "email" Nothing
    <*> areq urlField "appUrl" Nothing
    <*> aopt urlField "repoUrl" Nothing
    <*> areq passwordField "loginpass" Nothing 
    <*> pure False
    <*> pure " "
  -- unfortunate
  where createBlockApp appName devName email appUrl repoUrl pass verified verkey =
                (BlockApp
                        (T.unpack appName)
                        (T.unpack devName)
                        (T.unpack email)
                        (T.unpack appUrl)
                        (T.unpack <$> repoUrl)
                        (T.encodeUtf8 pass)
                        verified
                        (T.encodeUtf8 verkey))
