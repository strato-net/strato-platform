{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module API where

import Data.Aeson
import Data.Proxy
import Servant
import qualified GHC.Generics                        as GHCG

import Blockchain.Data.Address

--(Sender address, sender signature, beneficiary address, voting up or down)
data CandidateReceived = CandidateReceived { sender :: Address
                                           , signature :: String
                                           , recipient :: Address
                                           , toInclude :: Bool
                                           } deriving (Show,GHCG.Generic)

type AdminAPI = GetVote

type GetVote = "vote" :> ReqBody '[JSON] CandidateReceived :> Post '[JSON] CandidateReceived

adminAPI :: Proxy AdminAPI
adminAPI = Proxy

instance FromJSON CandidateReceived
instance ToJSON CandidateReceived
