module Handler.Home where

import           Import

getHomeR :: Handler Html
getHomeR = do
    defaultLayout $ do
        aDomId <- newIdent
        setTitle "BlockApps.net"
        $(widgetFile "homepage")
