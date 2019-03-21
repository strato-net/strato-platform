{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}

module CodeCollection where

import Control.DeepSeq
import Control.Lens
import Data.Map (Map)
import qualified Data.Map as M
import Data.Maybe
import qualified Data.Text as T
import GHC.Generics

import           Blockchain.SolidVM.Exception

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
  } deriving (Show, Read, Generic, NFData)

makeLenses ''Contract

data CodeCollection =
  CodeCollection {
    _contracts :: Map String Contract
  } deriving (Show, Read, Generic, NFData)

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





applyInheritance :: CodeCollection -> CodeCollection
applyInheritance cc =
  cc{
    _contracts = M.map (addInheritedObjects cc) $ cc^.contracts
  }

addInheritedObjects :: CodeCollection -> Contract -> Contract
addInheritedObjects cc c =
  c{
  _functions=toUnionMaker _functions cc c,
  _storageDefs=toUnionMaker _storageDefs cc c,
  _enums=toUnionMaker _enums cc c,
  _structs=toUnionMaker _structs cc c,
  _constants=toUnionMaker _constants cc c
  }

getParents :: CodeCollection -> Contract -> [Contract]
getParents cc c =
  let toErr p = fromMaybe (internalError "contract parent does not exist" p)
  in map (\p -> toErr p . M.lookup p $ cc ^. contracts) $ c ^. parents

toUnionMaker :: (Ord a) => (Contract -> M.Map a b) -> CodeCollection -> Contract -> M.Map a b
toUnionMaker f cc c =
  let parents' = getParents cc c
      parentMaps = map (toUnionMaker f cc) parents'
  in M.unions $ f c : parentMaps
