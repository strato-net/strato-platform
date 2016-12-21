module Handler.ApiDocs where

import Import

getApiDocsR :: Handler Html
getApiDocsR = do

    defaultLayout $ do
        _ <- newIdent                        
        setTitle "BlockApps.net - API docs"
        sendFile "text/html" "apidocs/index.html"
