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



--import qualified Generic.Random                     as GR
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


-- instance Arbitrary a => Arbitrary (ContractF a) where
--   arbitrary = GR.genericArbitrary GR.uniform

instance Arbitrary Contract  where
  arbitrary = do -- GR.genericArbitrary GR.uniform
    --stateVars <- arbitrary
    a <- arbitrary
    varName <- genCourse
    varDecl <- arbitrary
    --arbitrary
    -- ary <- arbitrary SourceAnnotation
    oneof [return $ Contract {     
    _contractName = "qq",
    _parents = [],
    _constants  =  empty ,-- :: Map SolidString (ConstantDeclF a),
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


-- genVarIdName :: Gen String
-- genVarIdName = vectorOf 5 $ Test.QuickCheck.elements ['0'..'9']


genCourse ::  Gen String
genCourse = vectorOf 5 $ Test.QuickCheck.elements ['a'..'z']
  -- ls <- listOf1 $ Test.QuickCheck.elements ['a'..'z']
  -- ls2 <- listOf1 $Test.QuickCheck.elements ['a'..'z']
  -- return ls ++ ls2

-- genVarName :: Gen String
-- genVarName = do
--   --date <- genVarIdName
--   dates <- listOf1 $ frequency [(1, return date)]
--   courses <- traverse genCourse dates
--   return $ unwords courses
