{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
module Data.Source.Severity
  ( Severity(..)
  ) where

import           Control.DeepSeq
import           Data.Aeson                as Aeson hiding (Error)
import           Data.Data
import           GHC.Generics
import           Test.QuickCheck

data Severity = Debug | Info | Warning | Error
  deriving (Eq, Show, Ord, Enum, Bounded, Generic, Data, NFData, ToJSON, FromJSON)

instance Arbitrary Severity where
  arbitrary = oneof [pure Debug, pure Info, pure Warning, pure Error]