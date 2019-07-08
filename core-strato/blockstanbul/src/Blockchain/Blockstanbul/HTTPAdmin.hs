{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module Blockchain.Blockstanbul.HTTPAdmin (
  CandidateReceived(..),
  VoteResult(..),
  uploadVote,
  createWebServer
) where

import Servant
import Control.DeepSeq
import Control.Monad
import Data.Aeson
import qualified Data.ByteString.Lazy.Char8          as C8
import qualified GHC.Generics                        as GHCG
import Servant.Client

import Control.Monad.IO.Class
import Network.HTTP.Client (newManager, defaultManagerSettings)
import Test.QuickCheck
import UnliftIO.STM
import UnliftIO.Timeout

import Blockchain.Data.ArbitraryInstances()
import Blockchain.Strato.Model.Address
import Text.Format

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

data VoteResult = Enqueued | Rejected String deriving (Show, Eq, GHCG.Generic, NFData)

adminAPI :: Proxy AdminAPI
adminAPI = Proxy

instance FromJSON CandidateReceived
instance ToJSON CandidateReceived

instance Arbitrary CandidateReceived where
  arbitrary = liftM5 CandidateReceived arbitrary arbitrary arbitrary arbitrary arbitrary

-- Server

admin :: TQueue CandidateReceived -> TQueue VoteResult -> Server AdminAPI
admin ich och = createVote ich och

createVote :: TQueue CandidateReceived -> TQueue VoteResult -> CandidateReceived
           -> Handler CandidateReceived
createVote ich och cr = do
  mResp <- liftIO $ timeout 60000000 $ do -- 60s
    -- TODO: Tag requests with unique IDs, and `retry` the read when the response doesn't match
    atomically $ writeTQueue ich cr
    atomically $ readTQueue och
  case mResp of
    Nothing -> throwError $ err500 {
      errBody = C8.pack $ "timed out while waiting for vote response: " ++ show cr }
    Just (Rejected msg) -> throwError $ err400 {
      errBody = C8.pack $ "unable to accept vote: " ++ msg }
    Just Enqueued -> return cr

createWebServer :: TQueue CandidateReceived -> TQueue VoteResult -> Application
createWebServer ich och = serve adminAPI (admin ich och)

-- Client

getVote :: CandidateReceived -> ClientM CandidateReceived
getVote = client (Proxy @ AdminAPI)

uploadVote ::  BaseUrl -> CandidateReceived -> IO (Either String ())
uploadVote url cr = do
  mgr <- newManager defaultManagerSettings
  vot <- runClientM (getVote cr) (ClientEnv mgr url Nothing)
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
