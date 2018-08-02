{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module Strato.Strato23.Server where

import           Data.Proxy
import           Servant
import           Data.Text

import           Strato.Strato23.API

-- postSignature :: Text -> handler SignatureDetails
-- postSignature x = return $SignatureDetails "12438971348519879" "21897342723782789" "28"

pingDetail :: String
pingDetail = "pong"

-- postSignature :: SignatureDetails
-- postSignature = SignatureDetails "12438971348519879" "21897342723782789" "28"

serveBloc :: Server StratoAPI
serveBloc = getPing
            :<|> signatureDetails
  where 
    getPing = return pingDetail
    
    signatureDetails :: Maybe Text -> Handler SignatureDetails
    signatureDetails x = return (SignatureDetails "12438971348519879" "21897342723782789" "28" x)
     

serverProxy :: Proxy StratoAPI
serverProxy = Proxy

router :: Application
router = serve serverProxy serveBloc
