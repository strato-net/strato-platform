{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

import Control.Exception (throw)
import qualified Data.Map as M
import Data.Maybe
import qualified Data.Set as S
import qualified Data.Text as T
import SolidVM.CodeCollectionTools
import SolidVM.Model.CodeCollection
import SolidVM.Model.SolidString
import SolidVM.Solidity.Parse.Declarations
import SolidVM.Solidity.Parse.File
import SolidVM.Solidity.Parse.ParserTypes
import SolidVM.Solidity.StaticAnalysis.Typechecker as TC
import System.Environment
import System.Exit
import Text.Parsec (runParser)
import Text.Printf

statementCrawler :: StatementF a -> [T.Text]
statementCrawler = \case
  AssemblyStatement {} -> ["AssemblyStatement"]
  Block _ -> ["Block"]
  Break _ -> ["Break"]
  Continue _ -> ["Continue"]
  ModifierExecutor _ -> ["ModifierExecutor"]
  Throw _ _ -> ["Throw"]
  EmitStatement _ evts _ -> "EmitStatement" : concatMap (expressionCrawler . snd) evts
  RevertStatement _ _ _ -> ["RevertStatement"] -- :concatMap (expressionCrawler) args
  UncheckedStatement blk _ ->
    ["UncheckedStatement"]
      ++ concatMap statementCrawler blk
  SimpleStatement st _ -> simpleStatementCrawler st
  Return mExpr _ -> "Return" : maybe [] expressionCrawler mExpr
  DoWhileStatement blk test _ ->
    "DoWhileStatement" :
    (concatMap statementCrawler blk)
      ++ expressionCrawler test
  WhileStatement expr blk _ ->
    "WhileStatement" :
    expressionCrawler expr
      ++ concatMap statementCrawler blk
  IfStatement expr thn els _ ->
    "IfStatement" :
    expressionCrawler expr
      ++ concatMap statementCrawler thn
      ++ maybe [] (concatMap statementCrawler) els
  ForStatement mInit mTest mInc blk _ ->
    "ForStatement" :
    maybe [] simpleStatementCrawler mInit
      ++ maybe [] expressionCrawler mTest
      ++ maybe [] expressionCrawler mInc
      ++ concatMap statementCrawler blk
  TryCatchStatement _ _ _ -> ["TryCatchStatement"]
  SolidityTryCatchStatement _ _ _ _ _ -> ["SolidityTryCatchStatement"]

expressionCrawler :: ExpressionF a -> [T.Text]
expressionCrawler = \case
  PlusPlus _ expr -> "PlusPlus" : expressionCrawler expr
  MinusMinus _ expr -> "MinusMinus" : expressionCrawler expr
  NewExpression {} -> ["NewExpression"]
  IndexAccess _ obj mIdx ->
    "IndexAccess" : do
      expr <- obj : maybeToList mIdx
      expressionCrawler expr
  MemberAccess _ expr _ -> "MemberAccess" : expressionCrawler expr
  FunctionCall _ func args ->
    "FunctionCall" : do
      expr <- case args of
        OrderedArgs args' -> func : args'
        NamedArgs args' -> func : map snd args'
      expressionCrawler expr
  Unitary _ n expr -> T.pack ("Unitary: " ++ n) : expressionCrawler expr
  Binary _ n lhs rhs ->
    T.pack ("Binary: " ++ n) : do
      expr <- [lhs, rhs]
      expressionCrawler expr
  Ternary _ cond thn els ->
    "Ternary" : do
      expr <- [cond, thn, els]
      expressionCrawler expr
  BoolLiteral {} -> ["BoolLiteral"]
  HexaLiteral {} -> ["HexaLiteral"]
  NumberLiteral {} -> ["NumberLiteral"]
  DecimalLiteral {} -> ["DecimalLiteral"]
  StringLiteral {} -> ["StringLiteral"]
  AccountLiteral {} -> ["AccountLiteral"]
  TupleExpression _ subexprs ->
    "TupleExpression" : do
      expr <- catMaybes subexprs
      expressionCrawler expr
  ArrayExpression _ subexprs ->
    "ArrayExpression" : do
      expr <- subexprs
      expressionCrawler expr
  Variable {} -> ["Variable"]
  ObjectLiteral {} -> ["ObjectLiteral"]

simpleStatementCrawler :: SimpleStatementF a -> [T.Text]
simpleStatementCrawler = \case
  ExpressionStatement expr -> expressionCrawler expr
  VariableDefinition _ mExpr -> maybe [] expressionCrawler mExpr

funcCrawler :: FuncF a -> [T.Text]
funcCrawler = maybe [] (concatMap statementCrawler) . _funcContents

contractCrawler :: Contract -> [T.Text]
contractCrawler Contract {..} = concatMap funcCrawler _functions ++ concatMap funcCrawler _constructor

-- codeCollectionCrawler extracts the set of nodes in a contract that must
-- be supported for SolidVM to accept the contract
codeCollectionCrawler :: CodeCollection -> S.Set T.Text
codeCollectionCrawler = S.fromList . concatMap contractCrawler . _contracts

main :: IO ()
main = do
  argv <- getArgs
  progName <- getProgName
  filename <- case argv of
    [] -> die $ printf "usage: %s <filename>" progName
    (fn : _) -> return fn
  contents <- readFile filename
  File parsedFile <- either (die . show) return $ runParser solidityFile initialParserState "" contents
  let namedContracts = [(textToLabel name, either (throw . fst) id $ xabiToContract (textToLabel name) (map textToLabel parents') M.empty xabi) | NamedXabi name (xabi, parents') <- parsedFile]
      cc = CodeCollection (M.fromList namedContracts) (M.empty) (M.empty) (M.empty) (M.empty) (M.empty) [] []
      typecheck = TC.detector cc
      nodes = codeCollectionCrawler cc
  putStrLn (show typecheck) --when (not null typecheck)
  mapM_ (putStrLn . T.unpack) nodes
