{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveFunctor     #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}

module SolidVM.Model.CodeCollection.ConstantDecl (
  ConstantDeclF(..),
  ConstantDecl,
  constType,
  constIsPublic,
  constInitialVal,
  constContext
  ) where

import           Control.Lens
import           Data.Aeson
import           Data.Source
import           GHC.Generics
import           Test.QuickCheck.Instances    ()

import           SolidVM.Model.CodeCollection.Statement
import qualified SolidVM.Model.Type as SVMType hiding (Enum)

data ConstantDeclF a = ConstantDecl
  { _constType       :: SVMType.Type
  , _constIsPublic   :: Bool
  , _constInitialVal :: (ExpressionF a)
  , _constContext    :: a
  } deriving (Show, Eq, Generic, Functor)

makeLenses ''ConstantDeclF

instance ToJSON a => ToJSON (ConstantDeclF a)
instance FromJSON a => FromJSON (ConstantDeclF a)

type ConstantDecl = Positioned ConstantDeclF
