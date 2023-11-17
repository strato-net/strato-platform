{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.Strato.Model.Nonce where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.ExtendedWord
import Control.DeepSeq (NFData)
import Control.Lens.Operators
import Data.Aeson hiding (Array, String)
import Data.Proxy
import Data.Swagger
import GHC.Generics
import Test.QuickCheck hiding ((.&.))

newtype Nonce = Nonce Word256
  deriving (Eq, Show, Generic)
  deriving newtype (Num, Ord, Enum, Bounded)
  deriving anyclass (NFData)

instance ToJSON Nonce where
  toJSON (Nonce n) = toJSON $ toInteger n

instance FromJSON Nonce where
  parseJSON = fmap (Nonce . fromInteger) . parseJSON

instance ToParamSchema Nonce where
  toParamSchema _ = toParamSchemaBoundedIntegral $ Proxy @Word256

instance ToSchema Nonce where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "Nonce")
        ( mempty
            & type_ ?~ SwaggerInteger
            & example ?~ toJSON (Nonce 1)
            & description ?~ "Numeric Nonce"
        )

instance Arbitrary Nonce where arbitrary = Nonce . fromInteger <$> arbitrary

instance RLPSerializable Nonce where
  rlpEncode (Nonce n) = rlpEncode n
  rlpDecode obj = Nonce $ rlpDecode obj

incrNonce :: Nonce -> Nonce
incrNonce (Nonce n) = Nonce (n + 1)
