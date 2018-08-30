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
import Blockchain.Data.Address

import API

admin :: TMChan (Address, String, Address, Bool) -> Server AdminAPI
admin = createVote

createVote :: TMChan (Address, String, Address, Bool) -> Address -> String -> Address -> Bool -> Handler (Address, String, Address, Bool)
createVote ch sender sign addr for_against = do
  liftIO $ atomically $ writeTMChan ch (sender, sign, addr, for_against)
  return (sender, sign, addr,for_against)

createWebServer :: TMChan (Address, String, Address,Bool) -> Application
createWebServer ch = serve adminAPI (admin ch)

webserver :: Int -> TMChan (Address, String, Address,Bool) -> IO()
webserver prt ch = run prt $ logStdoutDev (createWebServer ch)

getVote :: Address -> String -> Address -> Bool -> ClientM (Address, String,Address,Bool)
getVote = client (Proxy @ GetVote)

uploadVote ::  Int -> (Address, String, Address, Bool) -> IO()
uploadVote prt (sendr, sign, addr, bool)= do
  manager <- newManager defaultManagerSettings
  vot <- runClientM (getVote sendr sign addr bool) (ClientEnv manager (BaseUrl Http "localhost" prt ""))
  case vot of
    Left err -> putStrLn $ "Error: " ++ show err
    Right (sdr, signature, benf,nonce) -> do
      print sdr
      print signature
      print benf
      print nonce
