{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFoldable #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveTraversable #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}

module SolidVM.Model.CodeCollection.ConstantDecl
  ( ConstantDeclF (..),
    ConstantDecl,
    constType,
    constIsPublic,
    constInitialVal,
    constContext,
  )
where

import Control.DeepSeq
import Control.Lens
import Data.Aeson
import Data.Binary
import Data.Source
import GHC.Generics
import qualified Generic.Random as GR
import SolidVM.Model.CodeCollection.Statement
import qualified SolidVM.Model.Type as SVMType hiding (Enum)
import Test.QuickCheck
import Test.QuickCheck.Instances ()

-- Changes to this structure should also have changes in the Unparser :)
data ConstantDeclF a = ConstantDecl
  { _constType :: SVMType.Type,
    _constIsPublic :: Bool,
    _constInitialVal :: (ExpressionF a),
    _constContext :: a
  }
  deriving (Show, Eq, Generic, NFData, Functor, Foldable, Traversable)

makeLenses ''ConstantDeclF

instance Binary a => Binary (ConstantDeclF a)

instance ToJSON a => ToJSON (ConstantDeclF a)

instance FromJSON a => FromJSON (ConstantDeclF a)

type ConstantDecl = Positioned ConstantDeclF

instance Arbitrary a => Arbitrary (ConstantDeclF a) where
  arbitrary = GR.genericArbitrary GR.uniform
