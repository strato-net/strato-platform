module Handler.Test where

import Import

getTestR :: Handler Html
getTestR = defaultLayout $ do
    sendFile "text/html" "static/testreport.html"
