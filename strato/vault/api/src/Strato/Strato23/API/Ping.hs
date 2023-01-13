{-# LANGUAGE DataKinds     #-}
{-# LANGUAGE TypeOperators #-}

module Strato.Strato23.API.Ping where

import           Servant.API

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type GetPing = "_ping" :> Get '[JSON] String
