{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE DeriveGeneric #-}

module API where

import Data.Proxy
import Servant

import Blockchain.Data.Address
--import Blockchain.Blockstanbul.Messages (InEvent)


type AdminAPI = GetVote

type GetVote = "vote"
    :> Capture "nominee" Address
    :> Capture "for_against" Bool
    :> Get '[JSON] (Address, Bool)

adminAPI :: Proxy AdminAPI
adminAPI = Proxy





