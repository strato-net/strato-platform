{-# LANGUAGE DataKinds            #-}
{-# LANGUAGE DeriveGeneric        #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeOperators        #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Strato23.API.Signature where

import           Data.Aeson.Types
import           Data.LargeWord               (Word256)
import           Data.Swagger                 hiding (Header)
import           Data.Swagger.Internal.Schema (named)
import           Data.Text
import           Data.Word                    (Word8)
import           GHC.Generics
import           Servant.API
import           Strato.Strato23.API.Types

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type PostSignature = "signature"
                   :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
                   :> Header' '[Required, Strict] "X-USER-ID" Text
                   :> ReqBody '[JSON] UserData
                   :> Post '[JSON] SignatureDetails

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

instance ToSchema SignatureDetails where

instance ToSchema (Hex Word256) where
  declareNamedSchema = const . pure $ named "hex word256" binarySchema

instance ToSchema (Hex Word8) where
  declareNamedSchema = const . pure $ named "hex word8" binarySchema

instance ToJSON UserData
instance FromJSON UserData
instance ToSchema UserData where
