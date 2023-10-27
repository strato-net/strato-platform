{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}

module Strato.Strato23.API.Signature where

import Data.Text
import Servant.API
import Strato.Strato23.API.Types

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type PostSignature =
  "signature"
    :> Header' '[Optional, Strict] "X-USER-ACCESS-TOKEN" Text
    :> ReqBody '[JSON] MsgHash
    :> Post '[JSON] Signature

type PostSignature' =
  "signature"
    :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
    :> Header' '[Required, Strict] "X-IDENTITY-PROVIDER-ID" Text
    :> ReqBody '[JSON] MsgHash
    :> Post '[JSON] Signature
