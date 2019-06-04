{-# LANGUAGE DataKinds            #-}
{-# LANGUAGE DeriveGeneric        #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeOperators        #-}

module Strato.Strato23.API.Signature where

import           Data.Text
import           Servant.API
import           Strato.Strato23.API.Types

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type PostSignature = "signature"
                   :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
                   :> ReqBody '[JSON] UserData
                   :> Post '[JSON] SignatureDetails
