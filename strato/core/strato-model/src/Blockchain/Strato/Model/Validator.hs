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

data Validator
  = CommonName Text Text Text Bool
  deriving (Generic, Eq, Data, Show, Ord, Read)

instance NFData Validator where
  rnf (CommonName a b c d) = d `seq` c `seq` b `seq` a `seq` ()

instance Format Validator where
  format (CommonName _ _ c _) = T.unpack c

instance Binary Validator

instance Arbitrary Validator where
  arbitrary = GR.genericArbitrary GR.uniform

instance FromJSON Validator where
  parseJSON (Object o) = do
    a <- fromMaybe True <$> (o .:? "access")
    c <- o .:? "commonName"
    pure $ CommonName "" "" (fromMaybe "" c) a
  parseJSON o = fail $ "parseJSON ValidatorSetParsedSet failed: expected object, got: " ++ show o

instance ToJSON Validator where
  toJSON (CommonName o u c a) = object ["orgName" .= o, "orgUnit" .= u, "commonName" .= c, "access" .= a]

