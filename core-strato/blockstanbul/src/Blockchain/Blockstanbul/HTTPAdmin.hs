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
import Control.Monad
import Data.Aeson
import qualified GHC.Generics                        as GHCG
import Servant.Client

import Control.Concurrent.STM
import Control.Concurrent.STM.TMChan
import Control.Monad.IO.Class
import Network.HTTP.Client (newManager, defaultManagerSettings)
import Test.QuickCheck

import Blockchain.Data.Address
import Blockchain.Data.ArbitraryInstances()
import Blockchain.Format

-- API

type AdminAPI = GetVote

type GetVote = "vote" :> ReqBody '[JSON] CandidateReceived :> Post '[JSON] CandidateReceived

-- A signed tuple of (recipient, votingdir, nonce) from sender
data CandidateReceived = CandidateReceived { sender :: Address
                                           , signature :: String
                                           , recipient :: Address
                                           , votingdir :: Bool
                                           , nonce :: Int
                                           } deriving (Eq, Show, GHCG.Generic)

adminAPI :: Proxy AdminAPI
adminAPI = Proxy

instance FromJSON CandidateReceived
instance ToJSON CandidateReceived

instance Arbitrary CandidateReceived where
  arbitrary = liftM5 CandidateReceived arbitrary arbitrary arbitrary arbitrary arbitrary

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

uploadVote ::  Int -> String -> CandidateReceived -> IO (Either String ())
uploadVote prt ipaddr cr = do
  manager <- newManager defaultManagerSettings
  vot <- runClientM (getVote cr) (ClientEnv manager (BaseUrl Http ipaddr prt "/blockstanbul"))
  return $ case vot of
    Left err -> Left $ "uploadVote: " ++ show err
    Right _ -> Right ()

instance Format CandidateReceived where
  format (CandidateReceived sdr sign rcp vdir nc) = unlines ["Sender address: " ++ format sdr,
    "Sender signature: " ++ sign,
    "Recipient address: " ++ format rcp,
    "Voting to add/delete: " ++ (if vdir then "Add" else "Delete"),
    "Nonce: " ++ show nc
    ]
