module Strato.Strato23.Server where

import           Data.Proxy
import           Servant

import           Strato.Strato23.API
import           Strato.Strato23.Server.Ping
import           Strato.Strato23.Server.Signature

serveBloc :: Server StratoAPI
serveBloc = getPing
  :<|> signatureDetails

serverProxy :: Proxy StratoAPI
serverProxy = Proxy

router :: Application
router = serve serverProxy serveBloc
