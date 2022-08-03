{-# LANGUAGE DeriveFunctor      #-}
{-# LANGUAGE DeriveGeneric      #-}
{-# LANGUAGE TemplateHaskell    #-}
{-# LANGUAGE DeriveFoldable     #-}
{-# LANGUAGE DeriveTraversable  #-}


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
import           SolidVM.Model.SolidString

data ContractF a =
  Contract {     
    _contractName :: SolidString,
    _parents :: [SolidString],
    _constants :: Map SolidString (ConstantDeclF a),
    _storageDefs :: Map SolidString (VariableDeclF a),
    _enums :: Map SolidString ([SolidString], a),
    _structs :: Map SolidString [(SolidString, SolidVM.FieldType, a)],
    _events :: Map SolidString (SolidVM.EventF a),
    _functions :: Map SolidString (FuncF a),
    _constructor :: Maybe (FuncF a),
    _vmVersion :: String,
    _contractContext :: a
  } deriving (Show, Generic, Functor, Foldable, Traversable)

instance ToJSON a => ToJSON (ContractF a)
instance FromJSON a => FromJSON (ContractF a)

type Contract = Positioned ContractF

makeLenses ''ContractF
