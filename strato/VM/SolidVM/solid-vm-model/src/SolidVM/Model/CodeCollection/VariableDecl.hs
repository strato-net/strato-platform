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
import           Control.DeepSeq
import           GHC.Generics
import           Test.QuickCheck.Instances    ()
import           Test.QuickCheck
import           SolidVM.Model.CodeCollection.Statement
import qualified SolidVM.Model.Type as SVMType hiding (Enum)


-- Changes to this structure should also have changes in the Unparser :)
data VariableDeclF a = VariableDecl
  { _varType       :: SVMType.Type
  , _varIsPublic   :: Bool
  , _varInitialVal :: Maybe (ExpressionF a)
  , _varContext    :: a
  , _isImmutable   :: Bool
  } deriving (Show, Eq, Generic, Functor, NFData, Foldable, Traversable)

makeLenses ''VariableDeclF

instance ToJSON a => ToJSON (VariableDeclF a)
instance FromJSON a => FromJSON (VariableDeclF a)

type VariableDecl = Positioned VariableDeclF


--TODO
--Just realize this needs to match
--The expression generator
--AKA I need to make more tests cases for this
instance Arbitrary VariableDecl  where
  arbitrary = do 
    a <- arbitrary
    exprss <- arbitrary
    oneof [return $ VariableDecl { 
    _varType       = (SVMType.Int Nothing Nothing)
  , _varIsPublic   = True
  , _varInitialVal = exprss
  , _varContext    = a
  , _isImmutable   = False
  }]
