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


{-# OPTIONS -fno-warn-unused-top-binds #-}

module SolidVM.Solidity.Xabi (
  XabiF(..),
  Xabi,
  XabiKind(..),
  ModifierF(..),
  Modifier,
  UsingF(..),
  Using,
  xabiFuncs,
  xabiConstr,
  xabiVars,
  xabiConstants,
  xabiTypes,
  xabiModifiers,
  xabiEvents,
  xabiKind,
  xabiUsing,
  xabiContext
  ) where

import           Control.Lens                 (makeLenses, mapped, (&), (?~))
import           Control.DeepSeq
import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (dropFPrefix)
import           Data.Aeson.Types
import           Data.Map.Strict              (Map)
import           Data.Source
import           Data.Swagger
import           Data.Text                    (Text)
import           GHC.Generics
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()

import           SolidVM.Model.CodeCollection.ConstantDecl
import           SolidVM.Model.CodeCollection.Event
import           SolidVM.Model.CodeCollection.Function
import           SolidVM.Model.CodeCollection.VariableDecl
import qualified SolidVM.Model.CodeCollection.Def  as SolidVM
import           SolidVM.Model.SolidString

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
  { _xabiFuncs     :: Map SolidString (FuncF a)
  , _xabiConstr    :: Map SolidString (FuncF a)
  , _xabiVars      :: Map SolidString (VariableDeclF a)
  , _xabiConstants :: Map SolidString (ConstantDeclF a)
  , _xabiTypes     :: Map SolidString SolidVM.Def
  , _xabiModifiers :: Map SolidString (ModifierF a)
  , _xabiEvents    :: Map SolidString (EventF a)
  , _xabiKind      :: XabiKind
  , _xabiUsing     :: Map Text (UsingF a)
  , _xabiContext   :: a
  } deriving (Eq,Show,Generic, Functor, Traversable, Foldable)

type Xabi = Positioned XabiF

data UsingF a = Using String a deriving (Eq,Show,Generic, Functor, Traversable, Foldable)

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

makeLenses ''XabiF