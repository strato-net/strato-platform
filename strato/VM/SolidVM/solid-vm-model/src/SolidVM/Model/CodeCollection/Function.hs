{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveFunctor     #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module SolidVM.Model.CodeCollection.Function (
  FuncF(..),
  Func,
  StateMutability(..),
  Visibility(..),
  ModifierF(..),
  Modifier,
  tShow,
  tShow',
  tRead
  ) where

import           Control.Lens                 (mapped, (&), (?~))
import           Control.DeepSeq
import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (dropFPrefix)
import           Data.Binary
import           Data.Map.Strict              (Map)
import           Data.Source
import           Data.Swagger
import           Data.Text                    (Text)
import qualified Generic.Random               as GR
import           GHC.Generics
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()
import           SolidVM.Model.CodeCollection.Statement
import qualified SolidVM.Model.CodeCollection.VarDef  as SolidVM
import           SolidVM.Model.SolidString

data StateMutability = Pure | Constant | View | Payable deriving (Eq, Ord, Show, Generic, NFData)

tShow :: StateMutability -> Text
tShow Pure = "pure"
tShow Constant = "constant"
tShow View = "view"
tShow Payable = "payable"

tRead :: Text -> Maybe StateMutability
tRead "pure" = Just Pure
tRead "constant" = Just Constant
tRead "view" = Just View
tRead "payable" = Just Payable
tRead _ = Nothing

instance ToJSON StateMutability where
  toJSON = String . tShow

instance FromJSON StateMutability where
  parseJSON = withText "StateMutability" $ \t ->
      case tRead t of
          Just sm -> pure sm
          Nothing -> fail $ "invalid StateMutability: " ++ show t

instance Binary StateMutability

instance Arbitrary StateMutability where
  arbitrary = GR.genericArbitrary GR.uniform
instance ToSchema StateMutability where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "State Mutability"
    & mapped.schema.description ?~ "Reserved keywords for function state mutability"
    & mapped.schema.example ?~ toJSON View

data FuncF a = Func
  { funcArgs :: [(Maybe SolidString, SolidVM.IndexedType)]
  , funcVals :: [(Maybe SolidString, SolidVM.IndexedType)]
  , funcStateMutability :: Maybe StateMutability

  -- These Values are only used for parsing and unparsing solidity.
  -- This data will not be stored in the db and will have no
  -- relevance when constructing from the db.
  , funcContents :: Maybe [StatementF a]
  , funcVisibility :: Maybe Visibility
  , funcConstructorCalls :: Map SolidString [(ExpressionF a)]
  , funcModifiers :: [(SolidString, [(ExpressionF a)])]
  , funcContext :: a
  , funcIsFree :: Bool
  , funcOverload :: [FuncF a]
  } deriving (Eq,Show, Generic, NFData, Functor)

instance ToJSON a => ToJSON (FuncF a)
instance FromJSON a => FromJSON (FuncF a)
instance Binary a => Binary (FuncF a)

type Func = Positioned FuncF

data Visibility = Private
                | Public
                | Internal
                | External
  deriving (Eq,Show,Generic, NFData)

tShow' :: Visibility -> Text
tShow' Private = "private"
tShow' Public = "public"
tShow' Internal = "internal"
tShow' External = "external"

instance ToJSON Visibility where
  toJSON = String . tShow'
instance FromJSON Visibility
instance Binary Visibility
instance Arbitrary Visibility where arbitrary = GR.genericArbitrary GR.uniform
instance ToSchema Visibility where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "Visibility of a Function"
    & mapped.schema.description ?~ "SolidVM Function Visibility"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: Visibility
      ex = Public



data ModifierF a = Modifier
  { modifierArgs     :: Map Text SolidVM.IndexedType
  , modifierSelector :: Text
  , modifierContents :: Maybe [StatementF a]
  , modifierContext  :: a
  } deriving (Eq,Show,Generic, NFData, Functor)

type Modifier = Positioned ModifierF

instance ToJSON a => ToJSON (ModifierF a) where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON a => FromJSON (ModifierF a) where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance Binary a => Binary (ModifierF a) where


--------------------------------------------------------------------------------

soliditySchemaOptions :: SchemaOptions
soliditySchemaOptions = SchemaOptions
  { fieldLabelModifier = camelCase . dropFPrefix
  , constructorTagModifier = id
  , datatypeNameModifier = id
  , allNullaryToStringTag = True
  , unwrapUnaryRecords = True
  }
