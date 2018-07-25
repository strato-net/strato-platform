{-# LANGUAGE DataKinds     #-}
{-# LANGUAGE TypeOperators #-}

module Strato.Strato23.API.Transaction where

import           Servant

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type PostSignature = "signature" :> ReqBody '[JSON] String :> Get '[JSON] String
