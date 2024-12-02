{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PolyKinds         #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE UndecidableInstances #-}

module Strato.Strato23.API.Signature where

import Servant.API
import Strato.Strato23.API.Types

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type family PostSignature r hs where
  PostSignature r hs = "signature"
                       :> ApiEmbed r hs
                       ( ReqBody '[JSON] MsgHash
                       :> Post '[JSON] Signature )
