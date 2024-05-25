{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Strato.Model.Validator
  ( ValidatorSet (..),
    Validator (..),
  )
where

import Control.DeepSeq
import Data.Aeson hiding (Array, String)
import Data.Binary
import Data.Data
import Data.List
import Data.Maybe (fromMaybe)
import qualified Data.Set as S
import Data.String
import Data.Text (Text)
import qualified Data.Text as T
import GHC.Generics
import qualified Generic.Random as GR
import Test.QuickCheck.Arbitrary
import Test.QuickCheck.Instances.Text ()
import Text.Format

newtype ValidatorSet = ValidatorSet {unValidatorSet :: S.Set Validator} deriving (Generic, Eq, Data, Show, Ord)

instance Format ValidatorSet where
  format (ValidatorSet validators) = "[" ++ intercalate ","  (map format $ S.toList validators) ++ "]"

newtype Validator = Validator Text deriving (Generic, Eq, Data, Show, Ord, Read, IsString)

instance NFData Validator where
  rnf (Validator c) = c `seq` ()

instance Format Validator where
  format (Validator c) = T.unpack c

instance Binary Validator

instance Arbitrary Validator where
  arbitrary = GR.genericArbitrary GR.uniform

instance FromJSON Validator where
  parseJSON (Object o) = do
    c <- o .:? "commonName"
    pure $ Validator $ fromMaybe "" c
  parseJSON o = fail $ "parseJSON ValidatorSetParsedSet failed: expected object, got: " ++ show o

instance ToJSON Validator where
  toJSON (Validator c) = object ["commonName" .= c]

