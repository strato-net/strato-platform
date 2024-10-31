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

module SolidVM.Model.CodeCollection.Function
  ( FuncF (..),
    Func,
    StateMutability (..),
    Visibility (..),
    ModifierF (..),
    Modifier,
    UsingF (..),
    Using,
    FunctionCallType (..),
    tShow,
    tShowVisibility,
    tRead,
    funcArgs,
    funcVals,
    funcStateMutability,
    funcContents,
    funcVisibility,
    funcVirtual,
    funcOverrides,
    funcConstructorCalls,
    funcModifiers,
    funcContext,
    funcIsFree,
    funcOverload,
    modifierArgs,
    modifierSelector,
    modifierContents,
    modifierContext,
    usingContract,
    usingType,
    usingContext,
  )
where

import Control.DeepSeq
import Control.Lens (makeLenses, mapped, (&), (?~))
import Data.Aeson
import Data.Aeson.Casing
import Data.Aeson.Casing.Internal (dropFPrefix)
import Data.Binary
import Data.Map.Strict (Map)
import Data.Source
import Data.Swagger
import Data.Text (Text)
import GHC.Generics
import qualified Generic.Random as GR
import SolidVM.Model.CodeCollection.Statement
import qualified SolidVM.Model.CodeCollection.VarDef as SolidVM
import SolidVM.Model.SolidString
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import qualified Text.Colors as CL

--------------------------------------------------------------------------------
soliditySchemaOptions :: SchemaOptions
soliditySchemaOptions =
  SchemaOptions
    { fieldLabelModifier = camelCase . dropFPrefix,
      constructorTagModifier = id,
      datatypeNameModifier = id,
      allNullaryToStringTag = True,
      unwrapUnaryRecords = True
    }

--------------------------------------------------------------------------------

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

instance Binary StateMutability

instance ToJSON StateMutability where
  toJSON = String . tShow

instance FromJSON StateMutability where
  parseJSON = withText "StateMutability" $ \t ->
    case tRead t of
      Just sm -> pure sm
      Nothing -> fail $ "invalid StateMutability: " ++ show t

instance Arbitrary StateMutability where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema StateMutability where
  declareNamedSchema proxy =
    genericDeclareNamedSchema soliditySchemaOptions proxy
      & mapped . name ?~ "State Mutability"
      & mapped . schema . description ?~ "Reserved keywords for function state mutability"
      & mapped . schema . example ?~ toJSON View

data Visibility
  = Private
  | Public
  | Internal
  | External
  deriving (Eq, Show, Generic, NFData)

tShowVisibility :: Visibility -> Text
tShowVisibility Private = "private"
tShowVisibility Public = "public"
tShowVisibility Internal = "internal"
tShowVisibility External = "external"

instance Binary Visibility

instance ToJSON Visibility where
  toJSON = String . tShowVisibility

instance FromJSON Visibility

instance Arbitrary Visibility where arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema Visibility where
  declareNamedSchema proxy =
    genericDeclareNamedSchema soliditySchemaOptions proxy
      & mapped . name ?~ "Visibility of a Function"
      & mapped . schema . description ?~ "SolidVM Function Visibility"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: Visibility
      ex = Public

-- Changes to this structure should also have changes in the Unparser :)
data FuncF a = Func
  { _funcArgs :: [(Maybe SolidString, SolidVM.IndexedType)],
    _funcVals :: [(Maybe SolidString, SolidVM.IndexedType)],
    _funcStateMutability :: Maybe StateMutability,
    -- These Values are only used for parsing, not for the actual function
    -- This data will not be stored in the db and will have no
    -- relevance when constructing from the db.
    _funcContents :: Maybe [StatementF a],
    _funcVisibility :: Maybe Visibility,
    _funcVirtual :: Bool,
    _funcOverrides :: Maybe [SolidString], -- override can be for multiple contracts, e.g. override(Base1, Base2)
    _funcConstructorCalls :: Map SolidString [(ExpressionF a)],
    _funcModifiers :: [(SolidString, [(ExpressionF a)])],
    _funcContext :: a,
    _funcIsFree :: Bool,
    _funcOverload :: [FuncF a]
  }
  deriving (Eq, Generic, Functor, NFData, Foldable, Traversable)

instance Show a => Show (FuncF a) where
  show (Func {..}) =
    (CL.underline "\nFunctionF")
      ++ CL.magenta "\n_funcArgs\t" ++ show _funcArgs
      ++ CL.magenta "\n_funcVals\t" ++ show _funcVals
      ++ CL.magenta "\n_funcStateMutability\t" ++ show _funcStateMutability
      ++ CL.magenta "\n_funcContents\t" ++ show _funcContents
      ++ CL.magenta "\n_funcVisibility\t" ++ show _funcVisibility
      ++ CL.magenta "\n_funcVirtual\t" ++ show _funcVirtual
      ++ CL.magenta "\n_funcOverrides\t" ++ show _funcOverrides
      ++ CL.magenta "\n_funcConstructorCalls\t" ++ show _funcConstructorCalls
      ++ CL.magenta "\n_funcModifiers\t" ++ show _funcModifiers
      ++ CL.magenta "\n_funcContext\t" ++ show _funcContext
      ++ CL.magenta "\n_funcIsFree\t" ++ show _funcIsFree
      ++ CL.magenta "\n_funcOverload\t" ++ show _funcOverload

makeLenses ''FuncF

instance Binary a => Binary (FuncF a)

instance ToJSON a => ToJSON (FuncF a)

instance FromJSON a => FromJSON (FuncF a)

type Func = Positioned FuncF

data ModifierF a = Modifier
  { _modifierArgs     :: [(Text, SolidVM.IndexedType)],
    _modifierSelector :: Text,
    _modifierContents :: Maybe [StatementF a],
    _modifierContext  :: a
  }
  deriving (Eq, Show, Generic, NFData, Functor, Foldable, Traversable)

makeLenses ''ModifierF

type Modifier = Positioned ModifierF

instance Binary a => Binary (ModifierF a)

instance ToJSON a => ToJSON (ModifierF a) where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON a => FromJSON (ModifierF a) where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance Arbitrary a => Arbitrary (ModifierF a) where
  arbitrary = GR.genericArbitrary GR.uniform

data UsingF a = Using
  { _usingContract :: SolidString,
    _usingType :: SolidString, -- TODO: Use Type here
    _usingContext :: a
  }
  deriving (Eq, Show, Generic, Functor, NFData, Traversable, Foldable)

makeLenses ''UsingF

type Using = Positioned UsingF

instance Binary a => Binary (UsingF a)

instance ToJSON a => ToJSON (UsingF a) where
  toJSON (Using dec typ ctx) =
    object
      [ "using" .= dec,
        "for" .= typ,
        "context" .= ctx
      ]

instance FromJSON a => FromJSON (UsingF a) where
  parseJSON (Object o) =
    Using
      <$> (o .: "using")
      <*> (o .: "for")
      <*> (o .: "context")
  parseJSON o = fail $ "SolidVM.Using: Expected Object, got " ++ show o

instance Arbitrary a => Arbitrary (UsingF a) where
  arbitrary = Using <$> arbitrary <*> arbitrary <*> arbitrary

instance ToSchema Using where
  declareNamedSchema proxy =
    genericDeclareNamedSchema soliditySchemaOptions proxy
      & mapped . name ?~ "Using schema"
      & mapped . schema . description ?~ "Xabi of a `using` declaration"
      & mapped . schema . example ?~ toJSON sampleUsing
    where
      sampleUsing :: UsingF ()
      sampleUsing = Using "SafeMath" "uint256" ()

instance Arbitrary a => Arbitrary (FuncF a) where
  arbitrary = GR.genericArbitrary GR.uniform

data FunctionCallType
  = DefaultCall
  | RawCall
  | DelegateCall
  deriving (Eq, Show)
