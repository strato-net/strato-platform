module Handler.PushTransaction where

import Import

getPushTransactionR :: Handler ()
getPushTransactionR = do
   addHeader "Access-Control-Allow-Origin" "*"   
   sendFile "text/js" "static/js/pushtx.js"


