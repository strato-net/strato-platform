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
-- import           Network.Wai                      (Request, requestHeaders)

-- Used for demo purpose will remove in next change
postSignature :: SignatureDetails
postSignature = SignatureDetails "12438971348519879" "21897342723782789" "28"

pingDetail :: String
pingDetail = "pong"

-- handler :: Maybe String -> ExceptT ServantErr IO [postSignature]
-- handler (Just "secret-code") = right [mydata]
-- handler _                    = left $ err403 { errBody = "no access" }

serveBloc :: Server StratoAPI
serveBloc = getPing
            :<|> signatureDetails
  where 
    getPing = return pingDetail
    SignatureDetails :: Maybe String -> signatureDetails
    signatureDetails = return postSignature
    -- signatureDetails 
      -- print x
      

    
    -- signatureDetails = return postSignature

serverProxy :: Proxy StratoAPI
serverProxy = Proxy

router :: Application
router = serve serverProxy serveBloc

