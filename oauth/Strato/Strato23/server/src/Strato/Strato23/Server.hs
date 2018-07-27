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

-- Used for demo purpose will remove in next change
users1 :: [User]
users1 =
  [ User "Isaac Newton"    372 "isaac@newton.co.uk"
  , User "Albert Einstein" 136 "ae@mc2.org"        
  ]

postSignature :: SignatureDetails
postSignature = SignatureDetails "12438971348519879" "21897342723782789" "28"

pingDetail :: String
pingDetail = "pong"

serveBloc :: Server StratoAPI
serveBloc = getPing
            :<|> users
            :<|> signatureDetails
  where 
    getPing = return pingDetail
    users = return users1
    signatureDetails = return postSignature

serverProxy :: Proxy StratoAPI
serverProxy = Proxy

router :: Application
router = serve serverProxy serveBloc

