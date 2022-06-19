{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TemplateHaskell #-}

module SolidVM.Model.CodeCollection.Contract (
  ContractF(..),
  Contract,
  contractName,
  parents,
  constants,
  storageDefs,
  enums,
  structs,
  events,
  functions,
  constructor,
  vmVersion,
  contractContext
  ) where

import Control.Lens
import Data.Aeson as A
import Data.Map (Map)
import Data.Source
import GHC.Generics

import           SolidVM.Model.CodeCollection.ConstantDecl
import qualified SolidVM.Model.CodeCollection.Event as SolidVM
import           SolidVM.Model.CodeCollection.Function
import qualified SolidVM.Model.CodeCollection.VarDef as SolidVM
import           SolidVM.Model.CodeCollection.VariableDecl
import           SolidVM.Model.Label

data ContractF a =
  Contract {
    _contractName :: Label,
    _parents :: [Label],
    _constants :: Map Label (ConstantDeclF a),
    _storageDefs :: Map Label (VariableDeclF a),
    _enums :: Map Label ([Label], a),
    _structs :: Map Label [(Label, SolidVM.FieldType, a)],
    _events :: Map Label (SolidVM.EventF a),
    _functions :: Map Label (FuncF a),
    _constructor :: Maybe (FuncF a),
    _vmVersion :: String,
    _contractContext :: a
  } deriving (Show, Generic, Functor)

instance ToJSON a => ToJSON (ContractF a)
instance FromJSON a => FromJSON (ContractF a)

type Contract = Positioned ContractF

makeLenses ''ContractF
