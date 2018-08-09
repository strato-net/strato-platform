{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE DeriveGeneric #-}

module API where

import Data.Proxy
import Servant

import Blockchain.Data.Address
import Blockchain.Blockstanbul.Messages (InEvent)


type AdminAPI = 
  "vote"
    :> Capture "nominee" Address
    :> Capture "for_against" Bool
    :> Get '[JSON] InEvent

adminAPI :: Proxy AdminAPI
adminAPI = Proxy





