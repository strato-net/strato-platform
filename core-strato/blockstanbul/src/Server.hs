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
import Control.Concurrent.STM
import Control.Concurrent.STM.TMChan
import Control.Monad
--import Network.Wai
import Network.Wai.Handler.Warp
import Network.HTTP.Simple
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

webserver :: TMChan (Address,Bool) -> IO()
webserver ch = do
  chanIn ch
  run 8081 createWebServer

chanIn ::TMChan (Address,Bool) -> IO ()
chanIn ch = forever $ do                 -- need tests. streaming api instead?
  response <- httpJSON "http://localhost:8081/vote/"
  putStrLn $ "The status code was: " ++
               show (getResponseStatusCode response)
  print $ getResponseHeader "Content-Type" response
  let vote = getResponseBody response :: (Address,Bool)
  atomically $ writeTMChan ch vote

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
