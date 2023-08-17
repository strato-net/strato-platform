{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TemplateHaskell #-}

module Data.Source.Severity
  ( Severity (..),
    WithSeverity (..),
    severity,
    context,
    withSeverityContext,
    withSeverity,
  )
where

import Control.DeepSeq
import Control.Lens
import Data.Aeson as Aeson hiding (Error)
import Data.Data
import GHC.Generics
import Test.QuickCheck

data Severity = Debug | Info | Warning | Error
  deriving (Eq, Show, Ord, Enum, Bounded, Generic, Data, NFData, ToJSON, FromJSON)

instance Arbitrary Severity where
  arbitrary = oneof [pure Debug, pure Info, pure Warning, pure Error]

data WithSeverity a = WithSeverity
  { _severity :: Severity,
    _context :: a
  }
  deriving (Eq, Show, Ord, Generic, Functor, Data, NFData, ToJSON, FromJSON)

makeLenses ''WithSeverity

withSeverityContext :: WithSeverity a -> a
withSeverityContext = _context

withSeverity :: Functor f => Severity -> f a -> f (WithSeverity a)
withSeverity = fmap . WithSeverity
