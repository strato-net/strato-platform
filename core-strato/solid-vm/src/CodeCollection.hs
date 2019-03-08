{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}

module CodeCollection where

import Control.Lens
import Data.Map (Map)
import qualified Data.Map as M
import           Data.Maybe
import qualified Data.Text as T

import           SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.File
import           SolidVM.Solidity.Xabi
import qualified SolidVM.Solidity.Xabi as Xabi
import qualified SolidVM.Solidity.Xabi.Def as Xabi
import qualified SolidVM.Solidity.Xabi.VarDef as Xabi

data Contract =
  Contract {
    _contractName :: String,
    _parents :: [String],
    _constants :: Map String ConstantDecl,
    _storageDefs :: Map String VariableDecl,
    _enums :: Map String [String],
    _structs :: Map String [(T.Text, Xabi.FieldType)],
    _functions :: Map String Func,
    _constructor :: Maybe Func
  } deriving (Show, Read)

makeLenses ''Contract

data CodeCollection =
  CodeCollection {
    _contracts :: Map String Contract
  } deriving (Show, Read)

makeLenses ''CodeCollection


emptyCodeCollection :: CodeCollection
emptyCodeCollection =
  CodeCollection M.empty



xabiToContract :: String -> [String] -> Xabi -> Contract
xabiToContract contractName' parents' xabi =
  Contract {
  _contractName = contractName',
  _parents = parents',
  _storageDefs = M.fromList $ map (\(k,v) -> (T.unpack k, v)) $ M.toList $ Xabi.xabiVars xabi,
  _constants = M.fromList $ map (\(k,v) -> (T.unpack k, v)) $ M.toList $ Xabi.xabiConstants xabi,
  _enums = M.fromList [(T.unpack name, map T.unpack vals) | (name, Xabi.Enum vals _) <- M.toList $ Xabi.xabiTypes xabi],
  _structs = M.fromList [(T.unpack name, vals) | (name, Xabi.Struct vals _) <- M.toList $ Xabi.xabiTypes xabi],
  _functions = M.fromList $ map (\(k,v) -> (T.unpack k, v)) $ M.toList $ Xabi.xabiFuncs xabi,
  _constructor =
      case M.toList $ Xabi.xabiConstr xabi of
        [] -> Nothing
        [(_, x)] -> Just x
        _ -> error "multiple constructors in contract" --TODO- figure out if this is allowed in Solidity
  }





applyInheritence :: CodeCollection -> CodeCollection
applyInheritence cc =
  cc{
    _contracts = M.map (addInheritedObjects cc) $ cc^.contracts
  }

addInheritedObjects :: CodeCollection -> Contract -> Contract
addInheritedObjects cc c =
  c{
  _functions=getContractFunctions cc c,
  _storageDefs=getContractStorageDefs cc c,
  _enums=getContractEnums cc c,
  _structs=getContractStructs cc c
  }

getContractFunctions :: CodeCollection -> Contract -> Map String Xabi.Func
getContractFunctions cc c =
  let parentContracts = map (\p -> fromMaybe (error $ "contract parent name doesn't exist: " ++ p) $ M.lookup p $ cc^.contracts) $ c^.parents
      parentFunctions = map (getContractFunctions cc) parentContracts :: [Map String Xabi.Func]
  in M.unions $ c^.functions:parentFunctions

getContractStorageDefs :: CodeCollection -> Contract -> Map String Xabi.VariableDecl
getContractStorageDefs cc c =
  let parentContracts = map (\p -> fromMaybe (error $ "contract parent name doesn't exist: " ++ p) $ M.lookup p $ cc^.contracts) $ c^.parents
      parentStorageDefs = map (getContractStorageDefs cc) parentContracts
  in M.unions $ c^.storageDefs:parentStorageDefs

getContractEnums :: CodeCollection -> Contract -> Map String [String]
getContractEnums cc c =
  let parentContracts = map (\p -> fromMaybe (error $ "contract parent name doesn't exist: " ++ p) $ M.lookup p $ cc^.contracts) $ c^.parents
      parentEnums = map (getContractEnums cc) parentContracts :: [Map String [String]]
  in M.unions $ c^.enums:parentEnums

getContractStructs :: CodeCollection -> Contract -> Map String [(T.Text, Xabi.FieldType)]
getContractStructs cc c =
  let parentContracts = map (\p -> fromMaybe (error $ "contract parent name doesn't exist: " ++ p) $ M.lookup p $ cc^.contracts) $ c^.parents
      parentStructs = map (getContractStructs cc) parentContracts
  in M.unions $ c^.structs:parentStructs



getFunction :: File -> T.Text -> T.Text -> (T.Text, Xabi.Func)
getFunction file name functionName =
  let
    Just contract' = lookup name $ [(name', xabi) | NamedXabi name' (xabi, _) <- unsourceUnits file]

    Just func = M.lookup functionName $ Xabi.xabiFuncs contract'
  in (functionName, func)

