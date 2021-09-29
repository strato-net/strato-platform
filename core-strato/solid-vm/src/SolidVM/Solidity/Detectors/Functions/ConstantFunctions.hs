{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
module SolidVM.Solidity.Detectors.Functions.ConstantFunctions
  ( detector
  ) where

import           CodeCollection
import           Control.Monad.Reader
import           Control.Monad.Trans.State
import           Data.Foldable (traverse_)
import qualified Data.Map.Strict as M
import           Data.Maybe      (isJust)
import           Data.Source
import           Data.Text       (Text)
import qualified Data.Text       as T
import           SolidVM.Solidity.Xabi
import           SolidVM.Solidity.Xabi.Statement

type R = (StateMutability, M.Map String VariableDecl)
type SSS = StateT [M.Map String (SourceAnnotation ())] (Reader R)

-- type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]
detector :: CompilerDetector
detector CodeCollection{..} = concat $ contractHelper <$> M.elems _contracts

contractHelper :: Contract -> [SourceAnnotation Text]
contractHelper Contract{..} = concat $ functionHelper _storageDefs <$> M.elems _functions

functionHelper :: M.Map String VariableDecl -> Func -> [SourceAnnotation Text]
functionHelper stateVariables Func{..} =
  let f mut = case funcContents of
        Nothing -> []
        Just stmts -> runReader (statementsHelper stmts) (mut, stateVariables)
   in case funcStateMutability of
        Nothing -> []
        Just Payable -> []
        Just m -> f m

statementsHelper :: [Statement] -> Reader R [SourceAnnotation Text]
statementsHelper ss = concat <$> evalStateT (traverse statementHelper ss) [M.empty]

statementsHelper' :: [Statement] -> SSS [SourceAnnotation Text]
statementsHelper' ss = do
  modify (M.empty:)
  anns <- concat <$> traverse statementHelper ss
  modify tail
  pure anns

isLocalVariable :: String -> SSS Bool
isLocalVariable name = foldr lookupVar False <$> get
  where lookupVar _ True = True
        lookupVar m _    = isJust $ M.lookup name m

pushLocalVariable :: String -> SourceAnnotation () -> SSS ()
pushLocalVariable name decl = modify $ \case
  [] -> error "This can't happen by the laws of physics"
  (x:xs) -> (M.insert name decl x):xs

pushLocalVariables :: [VarDefEntry] -> SSS ()
pushLocalVariables = traverse_ pushEntry
  where pushEntry BlankEntry = pure () 
        pushEntry VarDefEntry{..} = pushLocalVariable vardefName vardefContext

statementHelper :: Statement -> SSS [SourceAnnotation Text]
statementHelper (IfStatement cond thens mElse _) = do
  cs <- expressionHelper cond
  ts <- statementsHelper' thens
  es <- maybe (pure []) statementsHelper' mElse
  pure $ concat [cs, ts, es]
statementHelper (WhileStatement cond body _) = do
  cs <- expressionHelper cond
  bs <- statementsHelper' body
  pure $ concat [cs, bs]
statementHelper (ForStatement mInit mCond mPost body _) = do
  is <- maybe (pure []) simpleStatementHelper mInit
  cs <- maybe (pure []) expressionHelper mCond
  ps <- maybe (pure []) expressionHelper mPost
  bs <- statementsHelper' body
  pure $ concat [is, cs, ps, bs]
statementHelper (Block _) = pure []
statementHelper (DoWhileStatement body cond _) = do
  cs <- expressionHelper cond
  bs <- statementsHelper' body
  pure $ concat [bs, cs]
statementHelper (Continue _) = pure []
statementHelper (Break _) = pure []
statementHelper (Return mExpr _) =
  maybe (pure []) expressionHelper mExpr
statementHelper (Throw _) = pure []
statementHelper (EmitStatement _ vals _) =
  concat <$> traverse (expressionHelper . snd) vals
statementHelper (AssemblyStatement _ x) = asks fst >>= \case
  Payable -> pure []
  mut -> let msg = T.pack $ concat
               [ show mut
               , " function using assembly code."
               ]
          in pure [msg <$ x]
statementHelper (SimpleStatement stmt _) = simpleStatementHelper stmt

simpleStatementHelper :: SimpleStatement -> SSS [SourceAnnotation Text]
simpleStatementHelper (VariableDefinition vdefs mExpr) = do
  pushLocalVariables vdefs
  maybe (pure []) expressionHelper mExpr
simpleStatementHelper (ExpressionStatement expr) =
  expressionHelper expr

localVarReadHelper :: String -> SourceAnnotation () -> SSS [SourceAnnotation Text]
localVarReadHelper name x = do
  isLocal <- isLocalVariable name
  if isLocal
    then pure []
    else do
      ~(mut, stateVars) <- ask
      case M.lookup name stateVars of
        Nothing ->
          let msg = T.pack $ concat
                [ "Undefined variable: "
                , name
                ]
           in pure [msg <$ x]
        Just _ -> case mut of
          Pure ->
            let msg = T.pack $ concat
                  [ "Pure function reading state variable "
                  , name
                  ]
             in pure [msg <$ x]
          _ -> pure []

localVarWriteHelper :: String -> SourceAnnotation () -> SSS [SourceAnnotation Text]
localVarWriteHelper name x = do
  isLocal <- isLocalVariable name
  if isLocal
    then pure []
    else do
      ~(mut, stateVars) <- ask
      case M.lookup name stateVars of
        Nothing ->
          let msg = T.pack $ concat
                [ "Undefined variable: "
                , name
                ]
           in pure [msg <$ x]
        Just _ -> case mut of
          Payable -> pure []
          _ -> let msg = T.pack $ concat
                     [ show mut
                     , " function mutating state variable "
                     , name
                     ]
                in pure [msg <$ x]

expressionHelper :: Expression -> SSS [SourceAnnotation Text]
expressionHelper (Binary y "=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "+=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "-=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "*=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "/=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "%=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "|=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "&=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary y "^=" (Variable x name) b) = do
  ann <- localVarWriteHelper name (x <> y)
  bs <- expressionHelper b
  pure $ concat [ann, bs]
expressionHelper (Binary _ _ a b) =
  concat <$> traverse expressionHelper [a, b]
expressionHelper (PlusPlus y (Variable x name)) =
  localVarWriteHelper name (x <> y)
expressionHelper (PlusPlus _ e) = expressionHelper e
expressionHelper (MinusMinus y (Variable x name)) =
  localVarWriteHelper name (x <> y)
expressionHelper (MinusMinus _ e) = expressionHelper e
expressionHelper (NewExpression _ _) = pure []
expressionHelper (IndexAccess _ a b) = do
  as <- expressionHelper a
  bs <- maybe (pure []) expressionHelper b
  pure $ concat [as, bs]
expressionHelper (MemberAccess _ e _) = expressionHelper e
expressionHelper (FunctionCall _ e args) = do
  as <- case e of
          Variable _ _ -> pure []
          _ -> expressionHelper e
  bs <- case args of
          OrderedArgs es -> concat <$> traverse expressionHelper es
          NamedArgs nes -> concat <$> traverse expressionHelper (snd <$> nes)
  pure $ concat [as, bs]
expressionHelper (Unitary _ _ a) = expressionHelper a
expressionHelper (Ternary _ a b c) = concat <$> traverse expressionHelper [a, b, c]
expressionHelper (BoolLiteral _ _) = pure []
expressionHelper (NumberLiteral _ _ _) = pure []
expressionHelper (StringLiteral _ _) = pure []
expressionHelper (TupleExpression _ es) =
  concat <$> traverse (maybe (pure []) expressionHelper) es
expressionHelper (ArrayExpression _ es) = concat <$> traverse expressionHelper es
expressionHelper (Variable x name) =
  localVarReadHelper name x
