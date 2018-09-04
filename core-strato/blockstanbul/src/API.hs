{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE DeriveGeneric #-}

module API where

import Data.Proxy
import Servant

import Blockchain.Data.Address

type AdminAPI = GetVote

--(Sender address, sender signature, beneficiary address, voting up or down)
type CandidateReceived = (Address, String, Address, Bool)

type GetVote = "vote" :> ReqBody '[JSON] CandidateReceived :> Post '[JSON] (Address, String, Address, Bool)

adminAPI :: Proxy AdminAPI
adminAPI = Proxy
