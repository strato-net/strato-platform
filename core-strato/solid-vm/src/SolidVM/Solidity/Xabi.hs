{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveFunctor     #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module SolidVM.Solidity.Xabi (
  XabiF(..),
  Xabi,
  XabiKind(..),
  ModifierF(..),
  Modifier,
  UsingF(..),
  Using
  ) where

import           Control.Lens                 (mapped, (&), (?~))
import           Control.DeepSeq
import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (dropFPrefix)
import           Data.Aeson.Types
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as Map
import           Data.Source
import           Data.Swagger
import           Data.Text                    (Text)
import qualified Generic.Random               as GR
import           GHC.Generics
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()

import           SolidVM.Model.CodeCollection.ConstantDecl
import           SolidVM.Model.CodeCollection.Event
import           SolidVM.Model.CodeCollection.Function
import           SolidVM.Model.CodeCollection.VariableDecl
import qualified SolidVM.Model.CodeCollection.Def  as SolidVM
import qualified SolidVM.Model.Type as SVMType
import qualified SolidVM.Model.CodeCollection.VarDef  as SolidVM

data XabiKind = ContractKind
              | InterfaceKind
              | LibraryKind deriving (Eq, Show, Generic, NFData)

instance ToJSON XabiKind where
instance FromJSON XabiKind where
instance Arbitrary XabiKind where
  arbitrary = elements [ContractKind, InterfaceKind, LibraryKind]

instance ToSchema XabiKind where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "Xabi Kind Schema"
    & mapped.schema.description ?~ "Whether this xabi is a contract, a library, or an interface"
    & mapped.schema.example ?~ toJSON ContractKind

data XabiF a = Xabi
  { xabiFuncs     :: Map Text (FuncF a)
  , xabiConstr    :: Map Text (FuncF a)
  , xabiVars      :: Map Text (VariableDeclF a)
  , xabiConstants :: Map Text (ConstantDeclF a)
  , xabiTypes     :: Map Text (SolidVM.DefF a)
  , xabiModifiers :: Map Text (ModifierF a)
  , xabiEvents    :: Map Text (EventF a)
  , xabiKind      :: XabiKind
  , xabiUsing     :: Map Text (UsingF a)
  , xabiContext   :: a
  } deriving (Eq,Show, Generic, NFData, Functor)

type Xabi = Positioned XabiF

data ModifierF a = Modifier
  { modifierArgs     :: Map Text SolidVM.IndexedType
  , modifierSelector :: Text
  , modifierVals     :: Map Text SolidVM.IndexedType
  , modifierContents :: Maybe Text
  , modifierContext  :: a
  } deriving (Eq,Show,Generic, NFData, Functor)

type Modifier = Positioned ModifierF

instance ToJSON a => ToJSON (ModifierF a) where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON a => FromJSON (ModifierF a) where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance Arbitrary a => Arbitrary (ModifierF a) where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema Modifier where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
    & mapped.name ?~ "Function Modifier"
    & mapped.schema.description ?~ "Xabi Function Modifier"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: ModifierF ()
      ex = Modifier
        { modifierArgs = Map.fromList [("userAddress", SolidVM.IndexedType {indexedTypeIndex = 0, indexedTypeType = SVMType.Int {signed = Just False, bytes = Just 32}})]
        , modifierSelector = "0adfe412"
        , modifierVals = Map.fromList [("#0",SolidVM.IndexedType {indexedTypeIndex = 0, indexedTypeType = SVMType.Int {signed = Just False, bytes = Just 32}})]
        , modifierContents = Nothing
        , modifierContext = ()
        }

data UsingF a = Using String a deriving (Eq,Show,Generic, NFData, Functor)

type Using = Positioned UsingF

instance ToJSON a => ToJSON (UsingF a) where
  toJSON (Using dec ctx) = object
    [ "using" .= dec
    , "context" .= ctx
    ]

instance FromJSON a => FromJSON (UsingF a) where
  parseJSON (Object o) = Using
                     <$> (o .: "using")
                     <*> (o .: "context")
  parseJSON o = typeMismatch "SolidVM.Using" o

instance Arbitrary a => Arbitrary (UsingF a) where
  arbitrary = Using <$> arbitrary <*> arbitrary

instance ToSchema Using where
  declareNamedSchema proxy = genericDeclareNamedSchema soliditySchemaOptions proxy
     & mapped.name ?~ "Using schema"
     & mapped.schema.description ?~ "Xabi of a `using` declaration"
     & mapped.schema.example ?~ toJSON sampleUsing
     where sampleUsing :: UsingF ()
           sampleUsing = Using "for uint[]" ()

--------------------------------------------------------------------------------

soliditySchemaOptions :: SchemaOptions
soliditySchemaOptions = SchemaOptions
  { fieldLabelModifier = camelCase . dropFPrefix
  , constructorTagModifier = id
  , datatypeNameModifier = id
  , allNullaryToStringTag = True
  , unwrapUnaryRecords = True
  }
