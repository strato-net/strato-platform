module Handler.Tutorial where

import Import

getTutorialR :: Handler Html
getTutorialR = do
    defaultLayout $ do
        _ <- newIdent
        setTitle "BlockApps.net - Interactive tutorial"
        --  $(widgetFile "tutorial")
        sendFile "text/html" "static/tutorial.html"
