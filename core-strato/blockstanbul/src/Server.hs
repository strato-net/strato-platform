{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module Server where 

import Servant
import Control.Concurrent.STM
import Control.Concurrent.STM.TMChan
import Control.Monad.IO.Class
import Network.Wai.Handler.Warp
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

 {- where ch = do
          x <- atomically $ newTMChan
          return $ x :. EmptyContext-}

--getVote :: Address -> Bool -> ClientM (Address,Bool)
--getVote = client (Proxy @ GetVote)

--constructChannel :: IO()
--constructChannel = do
  --manager <- newManager defaultManagerSettings
  --vot <- runClientM getVote (mkClientEnv manager (BaseUrl Http "localhost" 8081 ""))
  --atomically $ writeTMChan chan vot
