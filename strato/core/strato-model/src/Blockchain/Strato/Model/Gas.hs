{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Strato.Model.Gas where

import Blockchain.Data.RLP
import Control.DeepSeq (NFData)
import Control.Lens.Operators
import Data.Aeson hiding (Array, String)
import Data.Swagger
import GHC.Generics
import Test.QuickCheck hiding ((.&.))

newtype Gas = Gas Integer
  deriving newtype (Num)
  deriving newtype (Integral)
  deriving newtype (Real)
  deriving anyclass (NFData)
  deriving (Show, Read, Enum, Eq, Ord, Generic)

getGasValue :: Gas -> Integer
getGasValue (Gas n) = n

instance Arbitrary Gas where arbitrary = Gas <$> arbitrary

instance ToJSON Gas where
  toJSON (Gas g) = toJSON g

instance FromJSON Gas where
  parseJSON = fmap Gas . parseJSON

instance ToParamSchema Gas where
  toParamSchema _ =
    mempty
      & type_ ?~ SwaggerInteger
      & minimum_ ?~ 0
      & maximum_ ?~ (2 ^ (256 :: Integer) - 1)
      & format ?~ "hex string"

instance ToSchema Gas where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "Gas")
        ( mempty
            & type_ ?~ SwaggerInteger
            & example ?~ toJSON (Gas 1000)
            & description ?~ "Number of Gas units"
        )

instance RLPSerializable Gas where
  rlpEncode (Gas n) = rlpEncode n
  rlpDecode obj = Gas $ rlpDecode obj