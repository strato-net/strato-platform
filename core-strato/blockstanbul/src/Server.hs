{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module Server where

import Servant
import Servant.Client
import Control.Concurrent.STM
import Control.Concurrent.STM.TMChan
import Control.Monad.IO.Class
import Network.Wai.Middleware.RequestLogger
import Network.Wai.Handler.Warp
import Network.HTTP.Client (newManager, defaultManagerSettings)
import API

admin :: TMChan CandidateReceived -> Server AdminAPI
admin = createVote

createVote :: TMChan CandidateReceived -> CandidateReceived -> Handler CandidateReceived
createVote ch cr = do
  liftIO $ atomically $ writeTMChan ch cr
  return cr

createWebServer :: TMChan CandidateReceived -> Application
createWebServer ch = serve adminAPI (admin ch)

webserver :: Int -> TMChan CandidateReceived -> IO()
webserver prt ch = run prt $ logStdoutDev (createWebServer ch)

getVote :: CandidateReceived -> ClientM CandidateReceived
getVote = client (Proxy @ AdminAPI)

uploadVote ::  Int -> CandidateReceived -> IO()
uploadVote prt cr = do
  manager <- newManager defaultManagerSettings
  vot <- runClientM (getVote cr) (ClientEnv manager (BaseUrl Http "localhost" prt ""))
  case vot of
    Left err -> putStrLn $ "Error??/: " ++ show err
    Right cr'-> do
      print cr'
