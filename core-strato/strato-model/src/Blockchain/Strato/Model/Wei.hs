{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TypeApplications      #-}

module Blockchain.Strato.Model.Wei where

import           Control.Lens.Operators
import           Control.DeepSeq (NFData)
import           Data.Aeson             hiding (Array, String)
import           Data.Proxy
import           Data.RLP
import           Data.Swagger
import           GHC.Generics
import           Test.QuickCheck        hiding ((.&.))

import           Blockchain.Strato.Model.ExtendedWord

newtype Wei = Wei Word256
  deriving (Eq,Show,Generic)
  deriving anyclass (NFData)

-- --TODO- this might be unsafe, since it could lead to an overflow.  A Word256 * 10^18 certainly can be much higer than a Word256
-- eth::Word256->Wei
-- eth = Wei

instance Arbitrary Wei where arbitrary = Wei . fromInteger <$> arbitrary

instance ToParamSchema Wei where
  toParamSchema _ = toParamSchemaBoundedIntegral $ Proxy @ Word256

instance ToSchema Wei where
  declareNamedSchema _ = return $
    NamedSchema (Just "Wei")
      ( mempty
        & type_ .~ SwaggerInteger
        & example ?~ toJSON (Wei 1000000)
        & description ?~ "Number of Wei currency units" )

instance ToJSON Wei where
  toJSON (Wei g) = toJSON $ toInteger g

instance FromJSON Wei where
  parseJSON = fmap (Wei . fromInteger) . parseJSON

instance RLPEncodable Wei where
  rlpEncode (Wei n) = rlpEncode $ toInteger n
  rlpDecode obj = Wei . fromInteger <$> rlpDecode obj

