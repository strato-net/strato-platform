{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.Strato.Model.Wei where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.ExtendedWord
import Control.DeepSeq (NFData)
import Control.Lens.Operators
import Data.Aeson hiding (Array, String)
import Data.Proxy
import Data.Swagger
import GHC.Generics
import Test.QuickCheck hiding ((.&.))

newtype Wei = Wei Word256
  deriving (Eq, Show, Generic)
  deriving anyclass (NFData)

-- --TODO- this might be unsafe, since it could lead to an overflow.  A Word256 * 10^18 certainly can be much higer than a Word256
-- eth::Word256->Wei
-- eth = Wei

instance Arbitrary Wei where arbitrary = Wei . fromInteger <$> arbitrary

instance ToParamSchema Wei where
  toParamSchema _ = toParamSchemaBoundedIntegral $ Proxy @Word256

instance ToSchema Wei where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "Wei")
        ( mempty
            & type_ ?~ SwaggerInteger
            & example ?~ toJSON (Wei 1000000)
            & description ?~ "Number of Wei currency units"
        )

instance ToJSON Wei where
  toJSON (Wei g) = toJSON $ toInteger g

instance FromJSON Wei where
  parseJSON = fmap (Wei . fromInteger) . parseJSON

instance RLPSerializable Wei where
  rlpEncode (Wei n) = rlpEncode n
  rlpDecode obj = Wei $ rlpDecode obj
