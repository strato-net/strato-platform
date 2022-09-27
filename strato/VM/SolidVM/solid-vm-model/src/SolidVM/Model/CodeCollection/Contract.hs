{-# LANGUAGE DeriveFunctor      #-}
{-# LANGUAGE DeriveGeneric      #-}
{-# LANGUAGE TemplateHaskell    #-}
{-# LANGUAGE DeriveFoldable     #-}
{-# LANGUAGE DeriveTraversable  #-}
{-# LANGUAGE DeriveAnyClass     #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances    #-}

module SolidVM.Model.CodeCollection.Contract (
  ContractF(..),
  Contract,
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
  constructor,
  vmVersion,
  contractContext
  ) where

import Control.Lens
import Control.DeepSeq
import Data.Aeson as A
import Data.Map (Map, empty, fromList)
import Data.Source
import GHC.Generics


import           Test.QuickCheck.Instances    ()
import           Test.QuickCheck

import           SolidVM.Model.CodeCollection.ConstantDecl
import qualified SolidVM.Model.CodeCollection.Event as SolidVM
import           SolidVM.Model.CodeCollection.Function
import qualified SolidVM.Model.CodeCollection.VarDef as SolidVM
import           SolidVM.Model.CodeCollection.VariableDecl
import           SolidVM.Model.SolidString

-- Changes to this structure should also have changes in the Unparser :)
data ContractF a =
  Contract {     
    _contractName :: SolidString,
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
    _vmVersion :: String,
    _contractContext :: a
  } deriving (Show, Generic, NFData, Functor, Foldable, Traversable)

instance ToJSON a => ToJSON (ContractF a)
instance FromJSON a => FromJSON (ContractF a)

type Contract = Positioned ContractF

makeLenses ''ContractF


instance Arbitrary Contract  where
  arbitrary = do 
    a <- arbitrary
    varName <- vectorOf 7 $ Test.QuickCheck.elements ['a'..'z'] --There is a chance this won't be unique
    varDecl <- arbitrary
    oneof [return $ Contract {     
    _contractName = "qq",
    _parents = [],
    _constants  =  empty ,                          -- :: Map SolidString (ConstantDeclF a),
    _storageDefs =  fromList [(varName, varDecl)],  -- :: Map SolidString (VariableDeclF a),
    _userDefined = empty ,
    _enums  =  empty ,
    _structs  =  empty ,
    _errors  =  empty ,
    _events  =  empty ,
    _functions =  empty ,
    _constructor  =  Nothing ,
    _modifiers  =  empty ,
    _vmVersion  =  "" ,
    _contractContext = a
  }]

