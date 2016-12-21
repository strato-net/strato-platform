module Handler.Raml where

import Import

getRamlR :: Handler Html
getRamlR = do
    addHeader "Access-Control-Allow-Origin" "*"
    defaultLayout $ do
        _ <- newIdent
        setTitle "BlockApps.net"
        sendFile "text/html" "config/routes.raml"