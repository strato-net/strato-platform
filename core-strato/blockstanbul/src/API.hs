{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE DeriveGeneric #-}

module API where

import Data.Proxy
import Servant

import Blockchain.Data.Address

type AdminAPI = GetVote

type GetVote = "vote"
    :> Capture "sender" Address
    :> Capture "signature" String
    :> Capture "nominee" Address
    :> Capture "for_against" Bool
    :> Get '[JSON] (Address, String, Address, Bool)

adminAPI :: Proxy AdminAPI
adminAPI = Proxy
