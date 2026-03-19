{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Strato.Model.Validator
  (
    Validator (..)
  )
where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Control.DeepSeq
import Control.Lens.Operators ((?~), (&))
import Data.Aeson hiding (Array, String)
import Data.Binary
import Data.Data
import Data.OpenApi hiding (Format, format, get, put)
import GHC.Generics
import Test.QuickCheck.Arbitrary
import Test.QuickCheck.Instances.Text ()
import Text.Format

newtype Validator = Validator Address
  deriving (Generic, Eq, Data, Show, Ord, Read, FromJSON, ToJSON, RLPSerializable, NFData, Format, Binary, Arbitrary)

instance ToSchema Validator where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "Validator")
        ( mempty
            & type_ ?~ OpenApiString
            & example ?~ "0c4cecae296c33f71f9a6e6fb57f418f9d5f7e82"
            & description ?~ "STRATO Validator Address"
        )
