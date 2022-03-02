{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module CodeCollection where

import Control.Lens
import Data.Aeson as A
import Data.Map (Map)
import qualified Data.Map as M
import Data.Maybe
import qualified Data.Set as S
import Data.Source
import Data.Traversable (for)
import qualified Data.Text as T
import GHC.Generics

import           Blockchain.SolidVM.Exception

import           SolidVM.Solidity.Parse.Declarations (SourceUnit)
import           SolidVM.Solidity.Xabi
import qualified SolidVM.Solidity.Xabi as Xabi
import qualified SolidVM.Solidity.Xabi.Def as Xabi
import qualified SolidVM.Solidity.Xabi.Statement as Xabi
import qualified SolidVM.Solidity.Xabi.VarDef as Xabi

data ContractF a =
  Contract {
    _contractName :: String,
    _parents :: [String],
    _constants :: Map String (ConstantDeclF a),
    _storageDefs :: Map T.Text (VariableDeclF a),
    _enums :: Map String ([String], a),
    _structs :: Map String [(T.Text, Xabi.FieldType, a)],
    _events :: Map T.Text (Xabi.EventF a),
    _functions :: Map String (FuncF a),
    _constructor :: Maybe (FuncF a),
    _vmVersion :: String,
    _contractContext :: a
  } deriving (Show, Generic, Functor)

instance ToJSON a => ToJSON (ContractF a)
instance FromJSON a => FromJSON (ContractF a)

type Contract = Positioned ContractF

makeLenses ''ContractF

data CodeCollectionF a =
  CodeCollection {
    _contracts :: Map String (ContractF a)
  } deriving (Show, Generic, Functor)

instance ToJSON a => ToJSON (CodeCollectionF a)
instance FromJSON a => FromJSON (CodeCollectionF a)

type CodeCollection = Positioned CodeCollectionF
type ParserDetector = [SourceUnit] -> [SourceAnnotation T.Text]
type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]

makeLenses ''CodeCollectionF

emptyCodeCollection :: CodeCollection
emptyCodeCollection =
  CodeCollection M.empty

type SolidEither = Either (Positioned ((,) SolidException))

xabiToContract :: String -> [String] -> String -> Xabi -> SolidEither Contract
xabiToContract contractName' parents' vmVersion' xabi = do
  validateXabi xabi
  constr <- case M.toList $ Xabi.xabiConstr xabi of
    [] -> Right Nothing
    [(_, x)] -> Right $ Just x
    _ -> Left $ ( DuplicateDefinition "multiple constructors in contract" (show contractName') --TODO- figure out if this is allowed in Solidity
                , Xabi.xabiContext xabi
                )
  pure Contract {
  _contractName = contractName',
  _parents = parents',
  _storageDefs = M.fromList $ M.toList $ Xabi.xabiVars xabi,
  _constants = M.fromList $ map (\(k,v) -> (T.unpack k, v)) $ M.toList $ Xabi.xabiConstants xabi,
  _enums = M.fromList [(T.unpack name, (map T.unpack vals, a)) | (name, Xabi.Enum vals _ a) <- M.toList $ Xabi.xabiTypes xabi],
  _structs = M.fromList [(T.unpack name, (\(k,v) -> (k,v,a)) <$> vals) | (name, Xabi.Struct vals _ a) <- M.toList $ Xabi.xabiTypes xabi],
  _events = Xabi.xabiEvents xabi,
  _functions = M.fromList $ map (\(k,v) -> (T.unpack k, v)) $ M.toList $ Xabi.xabiFuncs xabi,
  _constructor = constr,
  _vmVersion = vmVersion',
  _contractContext = Xabi.xabiContext xabi
  }

validateXabi :: Xabi -> SolidEither ()
validateXabi Xabi{xabiModifiers=mx, xabiContext=ctx} =
  case M.size mx of
      0 -> Right ()
      _ -> Left $ ( TODO "modifiers not supported by solidvm" (show mx)
                  , ctx
                  )


applyInheritance :: CodeCollection -> SolidEither CodeCollection
applyInheritance cc = do
  ccs <- traverse (addInheritedObjects cc) $ cc^.contracts
  pure $ cc{
    _contracts = ccs
  }

addInheritedObjects :: CodeCollection -> Contract -> SolidEither Contract
addInheritedObjects cc c = do
  fu <- toUnionMaker _functions cc c
  sd <- toUnionMaker _storageDefs cc c
  en <- toUnionMaker _enums cc c
  st <- toUnionMaker _structs cc c
  ev <- toUnionMaker _events cc c
  co <- toUnionMaker _constants cc c
  pure $ c{
  _functions=fu,
  _storageDefs=sd,
  _enums=en,
  _structs=st,
  _events = ev,
  _constants=co
  }

getParents :: CodeCollection -> Contract -> SolidEither [Contract]
getParents cc c =
  let toErr x p = maybe (Left ( InternalError "contract parent does not exist" p
                              , x
                              ))
                        Right
  in for (c ^. parents) $ \p ->
       toErr (c ^. contractContext) p . M.lookup p $ cc ^. contracts

toUnionMaker :: (Ord a) => (Contract -> M.Map a b) -> CodeCollection -> Contract -> SolidEither (M.Map a b)
toUnionMaker f cc c = do
  parents' <- getParents cc c
  parentMaps <- traverse (toUnionMaker f cc) parents'
  pure . M.unions $ f c : parentMaps

statementCrawler :: Xabi.StatementF a -> [T.Text]
statementCrawler = \case
  Xabi.AssemblyStatement{} -> ["AssemblyStatement"]
  Xabi.Block _ -> ["Block"]
  Xabi.Break _ -> ["Break"]
  Xabi.Continue _ -> ["Continue"]
  Xabi.Throw _ -> ["Throw"]
  Xabi.EmitStatement _ evts _ ->  "EmitStatement":concatMap (expressionCrawler . snd) evts
  Xabi.SimpleStatement st _ -> simpleStatementCrawler st
  Xabi.Return mExpr _ -> "Return":maybe [] expressionCrawler mExpr
  Xabi.DoWhileStatement blk test _ -> "DoWhileStatement"
                             :(concatMap statementCrawler blk)
                            ++ expressionCrawler test
  Xabi.WhileStatement expr blk _ -> "WhileStatement"
                           :expressionCrawler expr
                          ++ concatMap statementCrawler blk
  Xabi.IfStatement expr thn els _ -> "IfStatement"
                            :expressionCrawler expr
                           ++ concatMap statementCrawler thn
                           ++ maybe [] (concatMap statementCrawler) els
  Xabi.ForStatement mInit mTest mInc blk _ -> "ForStatement"
                                     : maybe [] simpleStatementCrawler mInit
                                    ++ maybe [] expressionCrawler mTest
                                    ++ maybe [] expressionCrawler mInc
                                    ++ concatMap statementCrawler blk

expressionCrawler :: Xabi.ExpressionF a -> [T.Text]
expressionCrawler = \case
  Xabi.PlusPlus _ expr -> "PlusPlus":expressionCrawler expr
  Xabi.MinusMinus _ expr -> "MinusMinus":expressionCrawler expr
  Xabi.NewExpression{} -> ["NewExpression"]
  Xabi.IndexAccess _ obj mIdx -> "IndexAccess" : do
    expr <- obj : maybeToList mIdx
    expressionCrawler expr
  Xabi.MemberAccess _ expr _ -> "MemberAccess":expressionCrawler expr
  Xabi.FunctionCall _ func args -> "FunctionCall" : do
    expr <- case args of
      Xabi.OrderedArgs args' -> func:args'
      Xabi.NamedArgs args' -> func:map snd args'
    expressionCrawler expr
  Xabi.Unitary _ n expr -> T.pack ("Unitary: " ++ n):expressionCrawler expr
  Xabi.Binary _ n lhs rhs -> T.pack ("Binary: " ++ n) : do
    expr <- [lhs, rhs]
    expressionCrawler expr
  Xabi.Ternary _ cond thn els -> "Ternary" : do
    expr <- [cond, thn, els]
    expressionCrawler expr
  Xabi.BoolLiteral{} -> ["BoolLiteral"]
  Xabi.NumberLiteral{} -> ["NumberLiteral"]
  Xabi.StringLiteral{} -> ["StringLiteral"]
  Xabi.AccountLiteral{} -> ["AccountLiteral"]
  Xabi.TupleExpression _ subexprs -> "TupleExpression" : do
    expr <- catMaybes subexprs
    expressionCrawler expr
  Xabi.ArrayExpression _ subexprs -> "ArrayExpression" : do
    expr <- subexprs
    expressionCrawler expr
  Xabi.Variable{} -> ["Variable"]

simpleStatementCrawler :: Xabi.SimpleStatementF a -> [T.Text]
simpleStatementCrawler = \case
  Xabi.ExpressionStatement expr -> expressionCrawler expr
  Xabi.VariableDefinition _ mExpr -> maybe [] expressionCrawler mExpr

funcCrawler :: Xabi.FuncF a -> [T.Text]
funcCrawler = maybe [] (concatMap statementCrawler) . Xabi.funcContents

contractCrawler :: Contract -> [T.Text]
contractCrawler Contract{..} = concatMap funcCrawler _functions ++ concatMap funcCrawler _constructor

-- codeCollectionCrawler extracts the set of nodes in a contract that must
-- be supported for SolidVM to accept the contract
codeCollectionCrawler :: CodeCollection -> S.Set T.Text
codeCollectionCrawler = S.fromList . concatMap contractCrawler . _contracts
