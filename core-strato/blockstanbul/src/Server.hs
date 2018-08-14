{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module Server where 

import Servant
--import Servant.Server
--import Servant.Client
import Control.Concurrent.STM.TMChan
--import Network.Wai
import Network.Wai.Handler.Warp
--import Network.HTTP.Client (newManager, defaultManagerSettings)
import Blockchain.Data.Address
--import Blockchain.Blockstanbul.Messages (InEvent(NewBeneficiary))

import API

admin :: Server AdminAPI 
admin = createVote 

createVote :: Address -> Bool -> Handler (Address, Bool)
createVote addr for_against = return (addr,for_against)

createWebServer :: Application
createWebServer = serve adminAPI admin

webserver :: IO()
webserver = run 8081 createWebServer

 {- where ch = do
          x <- atomically $ newTMChan
          return $ x :. EmptyContext-}

--getVote :: Address -> Bool -> ClientM (Address,Bool)
--getVote = client (Proxy @ GetVote)

type VotingMessage = TMChan (Address,Bool)

--constructChannel :: IO()
--constructChannel = do
  --manager <- newManager defaultManagerSettings
  --vot <- runClientM getVote (mkClientEnv manager (BaseUrl Http "localhost" 8081 ""))
  --atomically $ writeTMChan chan vot
