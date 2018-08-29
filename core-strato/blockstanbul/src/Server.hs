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
import Network.Wai.Handler.Warp
import Network.HTTP.Client (newManager, defaultManagerSettings)
import Blockchain.Data.Address

import API

admin :: TMChan (Address, Bool) -> Server AdminAPI 
admin = createVote

createVote :: TMChan (Address, Bool) -> Address -> Bool -> Handler (Address, Bool)
createVote ch addr for_against = do 
  liftIO $ atomically $ writeTMChan ch (addr, for_against) 
  return (addr,for_against)

createWebServer :: TMChan (Address,Bool) -> Application
createWebServer ch = serve adminAPI (admin ch)

webserver :: Int -> TMChan (Address,Bool) -> IO()
webserver prt ch = run prt $ createWebServer ch

getVote :: Address -> Bool -> ClientM (Address,Bool)
getVote = client (Proxy @ GetVote)

uploadVote ::  Int -> (Address, Bool) -> IO()
uploadVote prt (addr,bool)= do
  manager <- newManager defaultManagerSettings
  vot <- runClientM (getVote addr bool) (ClientEnv manager (BaseUrl Http "localhost" prt ""))
  case vot of
    Left err -> putStrLn $ "Error: " ++ show err
    Right (benf,nonce) -> do
      print benf
      print nonce
