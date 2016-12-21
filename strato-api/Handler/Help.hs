module Handler.Help where

import Import

getHelpR :: Handler Html
getHelpR = do
  defaultLayout $ do
   setTitle "BlockApps.net"
   $(widgetFile "help")
