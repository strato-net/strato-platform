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

{-# OPTIONS -fno-warn-unused-top-binds #-}

module SolidVM.Solidity.Xabi
  ( XabiF (..),
    Xabi,
    XabiKind (..),
    ModifierF (..),
    Modifier,
    UsingF (..),
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
    xabiContext,
  )
where

import Control.DeepSeq
import Control.Lens (makeLenses, mapped, (&), (?~))
import Data.Aeson
import Data.Aeson.Casing
import Data.Aeson.Casing.Internal (dropFPrefix)
import Data.Map.Strict (Map)
import Data.Source
import Data.Swagger
import GHC.Generics
import SolidVM.Model.CodeCollection.ConstantDecl
import qualified SolidVM.Model.CodeCollection.Def as SolidVM
import SolidVM.Model.CodeCollection.Event
import SolidVM.Model.CodeCollection.Function
import SolidVM.Model.CodeCollection.VariableDecl
import SolidVM.Model.SolidString
import Test.QuickCheck
import Test.QuickCheck.Instances ()

data XabiKind
  = ContractKind
  | InterfaceKind
  | AbstractKind
  | LibraryKind
  deriving (Eq, Show, Generic, NFData)

instance ToJSON XabiKind

instance FromJSON XabiKind

instance Arbitrary XabiKind where
  arbitrary = elements [ContractKind, InterfaceKind, AbstractKind, LibraryKind]

instance ToSchema XabiKind where
  declareNamedSchema proxy =
    genericDeclareNamedSchema soliditySchemaOptions proxy
      & mapped . name ?~ "Xabi Kind Schema"
      & mapped . schema . description ?~ "Whether this xabi is a contract, a library, or an interface"
      & mapped . schema . example ?~ toJSON ContractKind

data XabiF a = Xabi
  { _xabiFuncs :: Map SolidString (FuncF a),
    _xabiConstr :: Map SolidString (FuncF a),
    _xabiVars :: Map SolidString (VariableDeclF a),
    _xabiConstants :: Map SolidString (ConstantDeclF a),
    _xabiTypes :: Map SolidString SolidVM.Def,
    _xabiModifiers :: Map SolidString (ModifierF a),
    _xabiEvents :: Map SolidString (EventF a),
    _xabiKind :: XabiKind,
    _xabiUsing :: Map SolidString [UsingF a],
    _xabiContext :: a
  }
  deriving (Eq, Show, Generic, Functor, NFData, Traversable, Foldable)

type Xabi = Positioned XabiF

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

makeLenses ''XabiF
