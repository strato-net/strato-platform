{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveFunctor     #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module SolidVM.Model.CodeCollection.ConstantDecl (
  ConstantDeclF(..),
  ConstantDecl
  ) where

import           Data.Aeson
import           Data.Source
import           GHC.Generics
import           Test.QuickCheck.Instances    ()

import           SolidVM.Model.CodeCollection.Statement
import qualified SolidVM.Solidity.Xabi.Type as Xabi hiding (Enum)

data ConstantDeclF a = ConstantDecl
  { constType       :: Xabi.Type
  , constIsPublic   :: Bool
  , constInitialVal :: (ExpressionF a)
  , constContext    :: a
  } deriving (Show, Eq, Generic, Functor)

instance ToJSON a => ToJSON (ConstantDeclF a)
instance FromJSON a => FromJSON (ConstantDeclF a)

type ConstantDecl = Positioned ConstantDeclF
