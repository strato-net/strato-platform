{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module Blockchain.Blockstanbul.HTTPAdmin (
  CandidateReceived(..),
  uploadVote,
  createWebServer
) where

import Servant
import Data.Aeson
import qualified GHC.Generics                        as GHCG

import Blockchain.Data.Address
import Servant.Client
import Control.Concurrent.STM
import Control.Concurrent.STM.TMChan
import Control.Monad.IO.Class
import Network.HTTP.Client (newManager, defaultManagerSettings)

-- API

type AdminAPI = GetVote

type GetVote = "vote" :> ReqBody '[JSON] CandidateReceived :> Post '[JSON] CandidateReceived

-- A signed tuple of (recipient, votingdir, nonce) from sender
data CandidateReceived = CandidateReceived { sender :: Address
                                           , signature :: String
                                           , recipient :: Address
                                           , votingdir :: Bool
                                           , nonce :: Int
                                           } deriving (Show,GHCG.Generic)

adminAPI :: Proxy AdminAPI
adminAPI = Proxy

instance FromJSON CandidateReceived
instance ToJSON CandidateReceived

-- Server

admin :: TMChan CandidateReceived -> Server AdminAPI
admin = createVote

createVote :: TMChan CandidateReceived -> CandidateReceived -> Handler CandidateReceived
createVote ch cr = do
  liftIO $ atomically $ writeTMChan ch cr
  return cr

createWebServer :: TMChan CandidateReceived -> Application
createWebServer ch = serve adminAPI (admin ch)

-- Client

getVote :: CandidateReceived -> ClientM CandidateReceived
getVote = client (Proxy @ AdminAPI)

uploadVote ::  Int -> CandidateReceived -> IO ()
uploadVote prt cr = do
  manager <- newManager defaultManagerSettings
  vot <- runClientM (getVote cr) (ClientEnv manager (BaseUrl Http "localhost" prt ""))
  case vot of
    Left err -> putStrLn $ "Error??/: " ++ show err
    Right cr'-> do
      print cr'
