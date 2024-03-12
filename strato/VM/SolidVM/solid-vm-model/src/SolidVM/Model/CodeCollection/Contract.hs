{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFoldable #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveTraversable #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}

module SolidVM.Model.CodeCollection.Contract
  ( ContractF (..),
    Contract,
    ContractType (..),
    contractName,
    parents,
    constants,
    storageDefs,
    enums,
    userDefined,
    structs,
    errors,
    events,
    functions,
    modifiers,
    usings,
    constructor,
    contractType,
    importedFrom,
    contractContext,
  )
where

import Blockchain.Strato.Model.Account
import Control.Applicative ((<|>))
import Control.DeepSeq
import Control.Lens
import Data.Aeson as A
import Data.Binary
import Data.Default
import Data.Map (Map, empty, fromList)
import Data.Source
import Data.Swagger
import GHC.Generics
import SolidVM.Model.CodeCollection.ConstantDecl
import qualified SolidVM.Model.CodeCollection.Event as SolidVM
import SolidVM.Model.CodeCollection.Function
import qualified SolidVM.Model.CodeCollection.VarDef as SolidVM
import SolidVM.Model.CodeCollection.VariableDecl
import SolidVM.Model.SolidString
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import qualified Text.Colors as CL

data ContractType = ContractType | LibraryType | AbstractType | InterfaceType deriving (Show, Generic, NFData, Eq, ToJSON, FromJSON)

instance Binary ContractType

-- Changes to this structure should also have changes in the Unparser :)
data ContractF a = Contract
  { _contractName :: SolidString,
    _parents :: [SolidString],
    _constants :: Map SolidString (ConstantDeclF a),
    _storageDefs :: Map SolidString (VariableDeclF a),
    _userDefined :: Map String String,
    _enums :: Map SolidString ([SolidString], a),
    _structs :: Map SolidString [(SolidString, SolidVM.FieldType, a)],
    _errors :: Map SolidString [(SolidString, SolidVM.IndexedType, a)],
    _events :: Map SolidString (SolidVM.EventF a),
    _functions :: Map SolidString (FuncF a),
    _constructor :: Maybe (FuncF a),
    _modifiers :: Map SolidString (ModifierF a),
    _usings :: Map SolidString [UsingF a],
    _contractType :: ContractType,
    _importedFrom :: Maybe Account,
    _contractContext :: a
  }
  deriving (Eq, Generic, NFData, Functor, Foldable, Traversable)

instance (Show a) => Show (ContractF a) where
  show (Contract {..}) =
    (CL.underline "\nContractF") 
    ++ CL.cyan "\n_contractName\t" ++ show _contractName 
    ++ CL.cyan "\n_parents\t" ++ show _parents 
    ++ CL.cyan "\n_constants\t" ++ show _constants 
    ++ CL.cyan "\n_storageDefs\t" ++ show _storageDefs 
    ++ CL.cyan "\n_userDefined\t" ++ show _userDefined 
    ++ CL.cyan "\n_enums\t" ++ show _enums 
    ++ CL.cyan "\n_structs\t" ++ show _structs 
    ++ CL.cyan "\n_errors\t" ++ show _errors 
    ++ CL.cyan "\n_events\t" ++ show _events 
    ++ CL.cyan "\n_functions\t" ++ show _functions 
    ++ CL.cyan "\n_constructor\t" ++ show _constructor 
    ++ CL.cyan "\n_modifiers\t" ++ show _modifiers 
    ++ CL.cyan "\n_usings\t" ++ show _usings 
    ++ CL.cyan "\n_contractType\t" ++ show _contractType 
    ++ CL.cyan "\n_importedFrom\t" ++ show _importedFrom 
    ++ CL.cyan "\n_contractContext\t" ++ show _contractContext

instance Semigroup (ContractF a) where
  c1 <> c2 =
    Contract
      { _contractName = _contractName c1,
        _parents = _parents c1 <> _parents c2,
        _constants = _constants c1 <> _constants c2,
        _storageDefs = _storageDefs c1 <> _storageDefs c2,
        _userDefined = _userDefined c1 <> _userDefined c2,
        _enums = _enums c1 <> _enums c2,
        _structs = _structs c1 <> _structs c2,
        _errors = _errors c1 <> _errors c2,
        _events = _events c1 <> _events c2,
        _functions = _functions c1 <> _functions c2,
        _constructor = _constructor c1 <|> _constructor c2,
        _modifiers = _modifiers c1 <> _modifiers c2,
        _usings = _usings c1 <> _usings c2,
        _contractType = _contractType c1,
        _importedFrom = _importedFrom c1 <|> _importedFrom c2,
        _contractContext = _contractContext c1
      }

instance Default a => Monoid (ContractF a) where
  mempty = def

instance Binary a => Binary (ContractF a)

instance ToJSON a => ToJSON (ContractF a)

instance FromJSON a => FromJSON (ContractF a)

instance Default a => Default (ContractF a) where
  def =
    Contract
      { _contractName = "",
        _parents = [],
        _constants = empty,
        _storageDefs = empty,
        _userDefined = empty,
        _enums = empty,
        _structs = empty,
        _errors = empty,
        _events = empty,
        _functions = empty,
        _constructor = Nothing,
        _modifiers = empty,
        _usings = empty,
        _contractType = ContractType,
        _importedFrom = Nothing,
        _contractContext = def
      }

type Contract = Positioned ContractF

makeLenses ''ContractF

instance Arbitrary Contract where
  arbitrary = do
    a <- arbitrary
    varName <- vectorOf 7 $ Test.QuickCheck.elements ['a' .. 'z'] --There is a chance this won't be unique
    varDecl <- arbitrary
    oneof
      [ return $
          Contract
            { _contractName = "qq",
              _parents = [],
              _constants = empty, -- :: Map SolidString (ConstantDeclF a),
              _storageDefs = fromList [(varName, varDecl)], -- :: Map SolidString (VariableDeclF a),
              _userDefined = empty,
              _enums = empty,
              _structs = empty,
              _errors = empty,
              _events = empty,
              _functions = empty,
              _constructor = Nothing,
              _modifiers = empty,
              _usings = empty,
              _contractType = ContractType,
              _importedFrom = Nothing,
              _contractContext = a
            }
      ]

instance ToSchema Contract where
  declareNamedSchema =
    pure . pure $
      NamedSchema (Just "Contract") $
        mempty
          & description ?~ "A Solidity contract parsed for SolidVM"
          & example ?~ toJSON (def :: Contract)
