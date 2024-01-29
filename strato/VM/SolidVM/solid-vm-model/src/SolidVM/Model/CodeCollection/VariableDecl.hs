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

module SolidVM.Model.CodeCollection.VariableDecl
  ( VariableDeclF (..),
    VariableDecl,
    varType,
    varIsPublic,
    varInitialVal,
    varContext,
    isImmutable,
    isRecord,
  )
where

import Control.DeepSeq
import Control.Lens
import Data.Aeson
import Data.Binary
import Data.Source
import GHC.Generics
import SolidVM.Model.CodeCollection.Statement
import qualified SolidVM.Model.Type as SVMType hiding (Enum)
import Test.QuickCheck
import Test.QuickCheck.Instances ()

-- Changes to this structure should also have changes in the Unparser :)
data VariableDeclF a = VariableDecl
  { _varType :: SVMType.Type,
    _varIsPublic :: Bool,
    _varInitialVal :: Maybe (ExpressionF a),
    _varContext :: a,
    _isImmutable :: Bool,
    _isRecord :: Bool
  }
  deriving (Show, Eq, Generic, Functor, NFData, Foldable, Traversable)

makeLenses ''VariableDeclF

instance Binary a => Binary (VariableDeclF a)

instance ToJSON a => ToJSON (VariableDeclF a)

instance FromJSON a => FromJSON (VariableDeclF a)

type VariableDecl = Positioned VariableDeclF

instance Arbitrary VariableDecl where
  arbitrary =
    oneof
      [ (VariableDecl (SVMType.Int Nothing Nothing) True) <$> arbitrary <*> arbitrary <*> arbitrary <*> pure False,
        (VariableDecl (SVMType.String $ Just True) True) <$> arbitrary <*> arbitrary <*> arbitrary <*> pure False
      ]
