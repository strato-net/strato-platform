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

admin :: TMChan (Address, Address, Bool) -> Server AdminAPI
admin = createVote

createVote :: TMChan (Address, Address, Bool) -> Address -> Address -> Bool -> Handler (Address, Address, Bool)
createVote ch sender addr for_against = do
  liftIO $ atomically $ writeTMChan ch (sender, addr, for_against)
  return (sender, addr,for_against)

createWebServer :: TMChan (Address, Address,Bool) -> Application
createWebServer ch = serve adminAPI (admin ch)

webserver :: Int -> TMChan (Address, Address,Bool) -> IO()
webserver prt ch = run prt $ createWebServer ch

getVote :: Address -> Address -> Bool -> ClientM (Address, Address,Bool)
getVote = client (Proxy @ GetVote)

uploadVote ::  Int -> (Address, Address, Bool) -> IO()
uploadVote prt (sendr, addr, bool)= do
  manager <- newManager defaultManagerSettings
  vot <- runClientM (getVote sendr addr bool) (ClientEnv manager (BaseUrl Http "localhost" prt ""))
  case vot of
    Left err -> putStrLn $ "Error: " ++ show err
    Right (sdr, benf,nonce) -> do
      print sdr
      print benf
      print nonce
