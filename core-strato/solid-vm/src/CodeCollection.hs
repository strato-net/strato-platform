{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module CodeCollection where

import Control.DeepSeq
import Control.Lens
import Data.Binary
import Data.Map (Map)
import qualified Data.Map as M
import Data.Maybe
import qualified Data.Set as S
import qualified Data.Text as T
import GHC.Generics

import           Blockchain.SolidVM.Exception

import           SolidVM.Solidity.Xabi
import qualified SolidVM.Solidity.Xabi as Xabi
import qualified SolidVM.Solidity.Xabi.Def as Xabi
import qualified SolidVM.Solidity.Xabi.Statement as Xabi
import qualified SolidVM.Solidity.Xabi.VarDef as Xabi

data Contract =
  Contract {
    _contractName :: String,
    _parents :: [String],
    _constants :: Map String ConstantDecl,
    _storageDefs :: Map String VariableDecl,
    _enums :: Map String [String],
    _structs :: Map String [(T.Text, Xabi.FieldType)],
    _events :: Map T.Text Xabi.Event,
    _functions :: Map String Func,
    _constructor :: Maybe Func
  } deriving (Show, Read, Generic, NFData, Binary)

makeLenses ''Contract

data CodeCollection =
  CodeCollection {
    _contracts :: Map String Contract
  } deriving (Show, Read, Generic, NFData, Binary)

makeLenses ''CodeCollection


emptyCodeCollection :: CodeCollection
emptyCodeCollection =
  CodeCollection M.empty



xabiToContract :: String -> [String] -> Xabi -> Contract
xabiToContract contractName' parents' xabi = validateXabi xabi `seq`
  Contract {
  _contractName = contractName',
  _parents = parents',
  _storageDefs = M.fromList $ map (\(k,v) -> (T.unpack k, v)) $ M.toList $ Xabi.xabiVars xabi,
  _constants = M.fromList $ map (\(k,v) -> (T.unpack k, v)) $ M.toList $ Xabi.xabiConstants xabi,
  _enums = M.fromList [(T.unpack name, map T.unpack vals) | (name, Xabi.Enum vals _) <- M.toList $ Xabi.xabiTypes xabi],
  _structs = M.fromList [(T.unpack name, vals) | (name, Xabi.Struct vals _) <- M.toList $ Xabi.xabiTypes xabi],
  _events = Xabi.xabiEvents xabi,
  _functions = M.fromList $ map (\(k,v) -> (T.unpack k, v)) $ M.toList $ Xabi.xabiFuncs xabi,
  _constructor =
      case M.toList $ Xabi.xabiConstr xabi of
        [] -> Nothing
        [(_, x)] -> Just x
        _ -> error "multiple constructors in contract" --TODO- figure out if this is allowed in Solidity
  }

validateXabi :: Xabi -> ()
validateXabi Xabi{xabiModifiers=mx} =
  case M.size mx of
      0 -> ()
      _ -> todo "modifiers not supported by solidvm" mx


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

statementCrawler :: Xabi.Statement -> [T.Text]
statementCrawler = \case
  Xabi.AssemblyStatement{} -> ["AssemblyStatement"]
  Xabi.Block -> ["Block"]
  Xabi.Break -> ["Break"]
  Xabi.Continue -> ["Continue"]
  Xabi.Throw -> ["Throw"]
  Xabi.EmitStatement _ evts ->  "EmitStatement":concatMap (expressionCrawler . snd) evts
  Xabi.SimpleStatement st -> simpleStatementCrawler st
  Xabi.Return mExpr -> "Return":maybe [] expressionCrawler mExpr
  Xabi.DoWhileStatement blk test -> "DoWhileStatement"
                             :statementCrawler blk
                            ++ expressionCrawler test
  Xabi.WhileStatement expr blk -> "WhileStatement"
                           :expressionCrawler expr
                          ++ concatMap statementCrawler blk
  Xabi.IfStatement expr thn els -> "IfStatement"
                            :expressionCrawler expr
                           ++ concatMap statementCrawler thn
                           ++ maybe [] (concatMap statementCrawler) els
  Xabi.ForStatement mInit mTest mInc blk -> "ForStatement"
                                     : maybe [] simpleStatementCrawler mInit
                                    ++ maybe [] expressionCrawler mTest
                                    ++ maybe [] expressionCrawler mInc
                                    ++ concatMap statementCrawler blk

expressionCrawler :: Xabi.Expression -> [T.Text]
expressionCrawler = \case
  Xabi.PlusPlus expr -> "PlusPlus":expressionCrawler expr
  Xabi.MinusMinus expr -> "MinusMinus":expressionCrawler expr
  Xabi.NewExpression{} -> ["NewExpression"]
  Xabi.IndexAccess obj mIdx -> "IndexAccess" : do
    expr <- obj : maybeToList mIdx
    expressionCrawler expr
  Xabi.MemberAccess expr _ -> "MemberAccess":expressionCrawler expr
  Xabi.FunctionCall func args -> "FunctionCall" : do
    expr <- case args of
      Xabi.OrderedArgs args' -> func:args'
      Xabi.NamedArgs args' -> func:map snd args'
    expressionCrawler expr
  Xabi.Unitary n expr -> T.pack ("Unitary: " ++ n):expressionCrawler expr
  Xabi.Binary n lhs rhs -> T.pack ("Binary: " ++ n) : do
    expr <- [lhs, rhs]
    expressionCrawler expr
  Xabi.Ternary cond thn els -> "Ternary" : do
    expr <- [cond, thn, els]
    expressionCrawler expr
  Xabi.BoolLiteral{} -> ["BoolLiteral"]
  Xabi.NumberLiteral{} -> ["NumberLiteral"]
  Xabi.StringLiteral{} -> ["StringLiteral"]
  Xabi.TupleExpression subexprs -> "TupleExpression" : do
    expr <- catMaybes subexprs
    expressionCrawler expr
  Xabi.ArrayExpression subexprs -> "ArrayExpression" : do
    expr <- subexprs
    expressionCrawler expr
  Xabi.Variable{} -> ["Variable"]

simpleStatementCrawler :: Xabi.SimpleStatement -> [T.Text]
simpleStatementCrawler = \case
  Xabi.ExpressionStatement expr -> expressionCrawler expr
  Xabi.VariableDefinition _ mExpr -> maybe [] expressionCrawler mExpr

funcCrawler :: Xabi.Func -> [T.Text]
funcCrawler = maybe [] (concatMap statementCrawler) . Xabi.funcContents

contractCrawler :: Contract -> [T.Text]
contractCrawler Contract{..} = concatMap funcCrawler _functions ++ concatMap funcCrawler _constructor

-- codeCollectionCrawler extracts the set of nodes in a contract that must
-- be supported for SolidVM to accept the contract
codeCollectionCrawler :: CodeCollection -> S.Set T.Text
codeCollectionCrawler = S.fromList . concatMap contractCrawler . _contracts
