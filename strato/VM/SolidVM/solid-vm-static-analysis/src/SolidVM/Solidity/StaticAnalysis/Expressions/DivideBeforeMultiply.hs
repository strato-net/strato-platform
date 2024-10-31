{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module SolidVM.Solidity.StaticAnalysis.Expressions.DivideBeforeMultiply
  ( detector,
  )
where

import qualified Data.Map.Strict as M
import Data.Maybe (maybeToList)
import Data.Source
import Data.Text (Text)
import SolidVM.Model.CodeCollection
import SolidVM.Solidity.StaticAnalysis.Types

-- type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]
detector :: CompilerDetector
detector CodeCollection {..} = concat $ contractHelper <$> M.elems _contracts

contractHelper :: Contract -> [SourceAnnotation Text]
contractHelper Contract {..} = concat $ functionHelper <$> maybeToList _constructor ++ M.elems _functions

functionHelper :: Func -> [SourceAnnotation Text]
functionHelper Func {..} = case _funcContents of
  Nothing -> []
  Just stmts -> concat $ statementHelper <$> stmts

statementHelper :: Statement -> [SourceAnnotation Text]
statementHelper (IfStatement cond thens mElse _) =
  let cs = expressionHelper cond
      ts = concat $ statementHelper <$> thens
      es = concat $ maybe [] (map statementHelper) mElse
   in concat [cs, ts, es]
statementHelper (TryCatchStatement statements catches _) =
  let ts = concat $ statementHelper <$> statements
      cs = concat $ statementHelper <$> (concatMap (snd . snd) (M.toList catches))
   in concat [ts, cs]
statementHelper (SolidityTryCatchStatement expr _ successStatements catchesMap _) =
  let es = expressionHelper expr
      ts = concat $ statementHelper <$> successStatements
      cs = concat $ statementHelper <$> (concatMap (snd . snd) (M.toList catchesMap))
   in concat [es, ts, cs]
statementHelper (WhileStatement cond body _) =
  let cs = expressionHelper cond
      bs = concat $ statementHelper <$> body
   in concat [cs, bs]
statementHelper (ForStatement mInit mCond mPost body _) =
  let is = maybe [] simpleStatementHelper mInit
      cs = maybe [] expressionHelper mCond
      ps = maybe [] expressionHelper mPost
      bs = concat $ statementHelper <$> body
   in concat [is, cs, ps, bs]
statementHelper (Block _) = []
statementHelper (DoWhileStatement body cond _) =
  let cs = expressionHelper cond
      bs = concat $ statementHelper <$> body
   in concat [bs, cs]
statementHelper (Continue _) = []
statementHelper (ModifierExecutor _) = []
statementHelper (Break _) = []
statementHelper (Return mExpr _) =
  maybe [] expressionHelper mExpr
statementHelper (Throw e _) =
  expressionHelper e
statementHelper (EmitStatement _ vals _) =
  concatMap (expressionHelper . snd) vals
statementHelper (RevertStatement _ (OrderedArgs vals) _) =
  concatMap expressionHelper vals
statementHelper (RevertStatement _ (NamedArgs vals) _) =
  concatMap (expressionHelper . snd) vals
statementHelper (UncheckedStatement body _) =
  concat $ statementHelper <$> body
statementHelper (AssemblyStatement _ _) = []
statementHelper (SimpleStatement stmt _) = simpleStatementHelper stmt

simpleStatementHelper :: SimpleStatement -> [SourceAnnotation Text]
simpleStatementHelper (VariableDefinition _ mExpr) =
  maybe [] expressionHelper mExpr
simpleStatementHelper (ExpressionStatement expr) =
  expressionHelper expr

expressionHelper :: Expression -> [SourceAnnotation Text]
expressionHelper (Binary a "*" (Binary _ "/" b c) d) =
  let ann = const "Divide before multiply. Consider swapping the order of operations." <$> a
   in ann : concat [expressionHelper b, expressionHelper c, expressionHelper d]
expressionHelper (Binary a "*" b (Binary _ "/" c d)) =
  let ann = const "Divide before multiply. Consider swapping the order of operations." <$> a
   in ann : concat [expressionHelper b, expressionHelper c, expressionHelper d]
expressionHelper (Binary _ _ a b) = concat [expressionHelper a, expressionHelper b]
expressionHelper (PlusPlus _ e) = expressionHelper e
expressionHelper (MinusMinus _ e) = expressionHelper e
expressionHelper (NewExpression _ _) = []
expressionHelper (IndexAccess _ a b) =
  let as = expressionHelper a
      bs = maybe [] expressionHelper b
   in concat [as, bs]
expressionHelper (MemberAccess _ e _) = expressionHelper e
expressionHelper (FunctionCall _ e args) =
  let as = expressionHelper e
      bs = case args of
        OrderedArgs es -> concat $ expressionHelper <$> es
        NamedArgs nes -> concat $ expressionHelper . snd <$> nes
   in concat [as, bs]
expressionHelper (Unitary _ _ a) = expressionHelper a
expressionHelper (Ternary _ a b c) =
  concat [expressionHelper a, expressionHelper b, expressionHelper c]
expressionHelper (BoolLiteral _ _) = []
expressionHelper (NumberLiteral _ _ _) = []
expressionHelper (DecimalLiteral _ _) = []
expressionHelper (StringLiteral _ _) = []
expressionHelper (AccountLiteral _ _) = []
expressionHelper (TupleExpression _ es) =
  concat $ maybe [] expressionHelper <$> es
expressionHelper (ArrayExpression _ es) = concat $ expressionHelper <$> es
expressionHelper (Variable _ _) = []
expressionHelper (ObjectLiteral _ _) = []
expressionHelper (HexaLiteral _ _) = []
