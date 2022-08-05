{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveFunctor     #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module SolidVM.Model.CodeCollection.VariableDecl (
  VariableDeclF(..),
  VariableDecl
  ) where

import           Data.Aeson
import           Data.Source
import           Control.DeepSeq
import           GHC.Generics
import           Test.QuickCheck.Instances    ()

import           SolidVM.Model.CodeCollection.Statement
import qualified SolidVM.Model.Type as SVMType hiding (Enum)

data VariableDeclF a = VariableDecl
  { varType       :: SVMType.Type
  , varIsPublic   :: Bool
  , varInitialVal :: Maybe (ExpressionF a)
  , varContext    :: a
  } deriving (Show, Eq, Generic, NFData, Functor)

instance ToJSON a => ToJSON (VariableDeclF a)
instance FromJSON a => FromJSON (VariableDeclF a)

type VariableDecl = Positioned VariableDeclF
