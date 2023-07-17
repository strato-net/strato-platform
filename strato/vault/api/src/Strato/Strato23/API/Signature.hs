{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}

module Strato.Strato23.API.Signature where

import Servant.API
import Strato.Strato23.API.Types

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type PostSignature r hs = "signature"
                       :> ApiEmbed r hs
                       ( ReqBody '[JSON] MsgHash
                       :> Post '[JSON] Signature )
