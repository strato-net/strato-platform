{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveFunctor     #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE DeriveFoldable    #-}
{-# LANGUAGE DeriveTraversable #-}

module SolidVM.Model.CodeCollection.VariableDecl (
  VariableDeclF(..),
  VariableDecl,
  varType,
  varIsPublic,
  varInitialVal,
  varContext,
  isImmutable
  ) where

import           Control.Lens
import           Data.Aeson
import           Data.Source
import           GHC.Generics
import           Test.QuickCheck.Instances    ()

import           SolidVM.Model.CodeCollection.Statement
import qualified SolidVM.Model.Type as SVMType hiding (Enum)

data VariableDeclF a = VariableDecl
  { _varType       :: SVMType.Type
  , _varIsPublic   :: Bool
  , _varInitialVal :: Maybe (ExpressionF a)
  , _varContext    :: a
  , _isImmutable   :: Bool
  } deriving (Show, Eq, Generic, Functor, Foldable, Traversable)

makeLenses ''VariableDeclF

instance ToJSON a => ToJSON (VariableDeclF a)
instance FromJSON a => FromJSON (VariableDeclF a)

type VariableDecl = Positioned VariableDeclF
