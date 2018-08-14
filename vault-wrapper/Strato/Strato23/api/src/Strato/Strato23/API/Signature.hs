{-# LANGUAGE DataKinds     #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE DeriveGeneric  #-}

module Strato.Strato23.API.Signature where

import           Data.Aeson.Types
import           Data.LargeWord   (Word256)
import           Data.Text
import           Data.Word        (Word8)
import           GHC.Generics
import           Servant.API
import           Strato.Strato23.API.Types

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type PostSignature = "signature" :> Header "X-USER-UNIQUE-NAME" Text :> ReqBody '[JSON] UserData :> Post '[JSON] SignatureDetails

data SignatureDetails = SignatureDetails {
    r :: Hex Word256
  , s :: Hex Word256
  , v :: Hex Word8
} deriving (Eq, Show, Generic)

data UserData = UserData {
  msgHash :: Hex Word256
} deriving (Eq, Show, Generic)

instance ToJSON SignatureDetails
instance FromJSON SignatureDetails

instance ToJSON UserData
instance FromJSON UserData
