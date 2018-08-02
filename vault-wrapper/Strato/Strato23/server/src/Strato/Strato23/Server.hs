{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module Strato.Strato23.Server where

import           Data.Proxy
import           Servant

import           Strato.Strato23.API

postSignature :: SignatureDetails
postSignature = SignatureDetails "12438971348519879" "21897342723782789" "28"

pingDetail :: String
pingDetail = "pong"

serveBloc :: Server StratoAPI
serveBloc = getPing
            :<|> signatureDetails
  where 
    getPing = return pingDetail
    signatureDetails = return postSignature

serverProxy :: Proxy StratoAPI
serverProxy = Proxy

router :: Application
router = serve serverProxy serveBloc

