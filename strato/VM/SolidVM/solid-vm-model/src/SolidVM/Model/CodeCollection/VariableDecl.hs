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
--import           Data.Source.Annotation

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

instance Arbitrary VariableDecl  where -- I think I can turn this signature into an a
   arbitrary = do
      inter <- arbitrary
      oneof
        [return $ (VariableDecl (SVMType.Int (Just False) Nothing)    False Nothing  (dummyAnnotation) False)
        , return $ (VariableDecl (SVMType.Int (Just False) Nothing)   False (Just (NumberLiteral dummyAnnotation inter Nothing))  (dummyAnnotation) False)
        --, return $ (VariableDecl (SVMType.Int (Just False) Nothing)  False (Just 1)  (dummyAnnotation) False)
        , return $ (VariableDecl (SVMType.Int (Just False) Nothing)    False (Just (Binary dummyAnnotation  "+" (NumberLiteral dummyAnnotation  2 Nothing) (NumberLiteral dummyAnnotation  2 Nothing)) )   dummyAnnotation  False)
        ]


dummyAnnotation :: SourceAnnotation ()
dummyAnnotation =
  SourceAnnotation
  {
    _sourceAnnotationStart=SourcePosition {
      _sourcePositionName="",
      _sourcePositionLine=0,
      _sourcePositionColumn=0
      },
    _sourceAnnotationEnd=SourcePosition {
      _sourcePositionName="",
        _sourcePositionLine=0,
        _sourcePositionColumn=0
      },
    _sourceAnnotationAnnotation = ()
  }