{-# LANGUAGE DataKinds            #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeOperators        #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Strato23.API.NodeKey where

import           Data.Text
import           Servant.API
import           Strato.Strato23.API.Types

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------


type PostNodeKey = "nodekey"
            :> QueryParam "priv" Text
            :> POST '[JSON] NodeKey

type GetNodeKey = "nodekey"
            :> Post '[JSON] NodeKey
