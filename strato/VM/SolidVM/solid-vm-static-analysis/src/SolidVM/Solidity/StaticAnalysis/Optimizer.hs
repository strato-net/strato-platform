{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module SolidVM.Solidity.StaticAnalysis.Optimizer
  ( detector,
    varDeclHelper,
  )
where

import Control.Applicative ((<|>))
import Control.Lens
import Control.Monad (join)
import Control.Monad.Reader
import Control.Monad.Trans.State
import Data.Decimal
import Data.Functor.Compose
import Data.Map as M
import Data.Maybe (fromMaybe)
import SolidVM.Model.CodeCollection
import SolidVM.Model.SolidString (SolidString)
import qualified SolidVM.Model.Type as SVMType

data R = R
  { codeCollection :: CodeCollection,
    contract :: Maybe Contract
  }

type SSS = StateT (M.Map SolidString (Expression)) (Reader R) -- Is there a better data structure for this job?

detector :: CodeCollection -> CodeCollection
detector cc =
  over (contracts . mapped) (contractHelper cc) $
    over (flFuncs . mapped) (functionHelper cc Nothing) $
      over (flConstants . mapped) (constDeclHelper cc Nothing) cc

contractHelper ::
  CodeCollection ->
  Contract ->
  Contract
contractHelper cc c =
  (constructor . _Just %~ functionHelper cc (Just c)) $
    over (storageDefs . mapped) (varDeclHelper cc (Just c)) $
      over (functions . mapped) (functionHelper cc (Just c)) $
        over (constants . mapped) (constDeclHelper cc (Just c)) c

varDeclHelper ::
  CodeCollection ->
  Maybe Contract ->
  VariableDecl ->
  VariableDecl
varDeclHelper cc c v = case _varType v of
  (SVMType.UserDefined _ actua) -> v {_varType = actua, _varInitialVal = flip run actua <$> _varInitialVal v}
  _ -> v {_varInitialVal = flip run (_varType v) <$> _varInitialVal v}
  where
    run e t =
      let r = R cc c
       in runReader (evalStateT (optimizeExpression e (Just t)) M.empty) r

constDeclHelper ::
  CodeCollection ->
  Maybe Contract ->
  ConstantDecl ->
  ConstantDecl
constDeclHelper cc c v =
  case _constType v of
    (SVMType.UserDefined _ actua) -> v {_constType = actua, _constInitialVal = run (_constInitialVal v)}
    _ -> v {_constInitialVal = run $ _constInitialVal v}
  where
    run e =
      let r = R cc c
       in runReader (evalStateT (optimizeExpression e Nothing) M.empty) r

-- TODO clean this code up
functionHelper ::
  CodeCollection ->
  Maybe Contract ->
  Func ->
  Func
functionHelper cc mc f =
  case _funcContents f of
    Nothing -> f
    Just stmts ->
      if ((Just True) ==) $ M.null <$> (_userDefined <$> mc)
        then
          let r = R cc mc
           in f {_funcContents = Just $ runReader (optimizeStatements stmts) r}
        else
          let r = R cc mc
           in functionHelperForUserDefined f {_funcContents = Just $ runReader (optimizeStatements stmts) r}

functionHelperForUserDefined :: Func -> Func
functionHelperForUserDefined f = f {_funcArgs = tForm $ _funcArgs f, _funcVals = tForm $ _funcVals f}
  where
    tForm :: [(Maybe SolidString, IndexedType)] -> [(Maybe SolidString, IndexedType)]
    tForm =
      Prelude.map
        ( \(maybeSoldString, (IndexedType z y)) -> case (maybeSoldString, y) of
            (xxxx, (SVMType.UserDefined _ act)) -> (xxxx, (IndexedType z act))
            (xxxx, _) -> (xxxx, (IndexedType z y))
        )

optimizeStatements :: [Statement] -> Reader R [Statement]
optimizeStatements [] = pure $ []
optimizeStatements ((IfStatement cond thens mElse x) : ss) = do
  cond' <- (evalStateT (optimizeExpression cond Nothing) M.empty)
  case cond' of
    BoolLiteral _ True -> do
      thens' <- optimizeStatements thens
      (thens' ++) <$> optimizeStatements ss
    BoolLiteral _ False -> do
      elses' <- optimizeStatements $ fromMaybe [] mElse
      (elses' ++) <$> optimizeStatements ss
    _ -> do
      thens' <- optimizeStatements thens
      elses' <- traverse optimizeStatements mElse
      (IfStatement cond' thens' elses' x :) <$> optimizeStatements ss
optimizeStatements ((TryCatchStatement tryStatements catchMap x) : ss) = do
  tryStatements' <- optimizeStatements tryStatements
  catchMap' <- getCompose <$> traverse optimizeStatements (Compose catchMap)
  (TryCatchStatement tryStatements' catchMap' x :) <$> optimizeStatements ss
optimizeStatements ((SolidityTryCatchStatement expr mtpl successStatements catchMap x) : ss) = do
  expr' <- (evalStateT (optimizeExpression expr Nothing) M.empty)
  successStatements' <- optimizeStatements successStatements
  catchMap' <- getCompose <$> traverse optimizeStatements (Compose catchMap)
  (SolidityTryCatchStatement expr' mtpl successStatements' catchMap' x :) <$> optimizeStatements ss
optimizeStatements ((WhileStatement cond body x) : ss) = do
  cond' <- (evalStateT (optimizeExpression cond Nothing) M.empty)
  case cond' of
    BoolLiteral _ False -> optimizeStatements ss
    _ -> do
      body' <- optimizeStatements body
      (WhileStatement cond' body' x :) <$> optimizeStatements ss
optimizeStatements ((ForStatement mInit mCond mPost body x) : ss) = do
  let getExpression = (\xxx -> (evalStateT (optimizeExpression xxx Nothing) M.empty))
  mCond' <- traverse getExpression mCond
  mPost' <- traverse getExpression mPost
  body' <- optimizeStatements body
  (ForStatement mInit mCond' mPost' body' x :) <$> optimizeStatements ss
optimizeStatements ((Block _) : ss) = optimizeStatements ss
optimizeStatements ((DoWhileStatement body cond x) : ss) = do
  body' <- optimizeStatements body
  cond' <- (evalStateT (optimizeExpression cond Nothing) M.empty)
  case cond' of
    BoolLiteral _ False -> (body' ++) <$> optimizeStatements ss
    _ -> (DoWhileStatement body' cond' x :) <$> optimizeStatements ss
optimizeStatements (s@(Continue _) : _) = pure [s]
optimizeStatements (s@(Break _) : _) = pure [s]
optimizeStatements (s@(Throw _ _) : _) = pure [s]
optimizeStatements (s@(ModifierExecutor _) : ss) = (s :) <$> optimizeStatements ss
optimizeStatements (s@(EmitStatement {}) : ss) = (s :) <$> optimizeStatements ss
optimizeStatements (s@(RevertStatement {}) : _) = pure [s]
optimizeStatements (s@(UncheckedStatement _ _) : ss) = (s :) <$> optimizeStatements ss
optimizeStatements (s@(AssemblyStatement _ _) : ss) = (s :) <$> optimizeStatements ss
optimizeStatements (s@(SimpleStatement _ _) : ss) = do
  simpleStatementOptimized <- evalStateT (simpleStatementFHelper' s) M.empty
  (simpleStatementOptimized :) <$> optimizeStatements ss
optimizeStatements (s@(Return (Just _) _) : ss) = do
  ssss <- evalStateT (simpleStatementFHelper' s) M.empty
  (ssss :) <$> optimizeStatements ss
optimizeStatements (s@(Return _ _) : _) = pure [s]

-- Note two cases for simple statement:
-- 1. VariableDefinition [VarDefEntryF a] (Maybe (ExpressionF a))
-- 2. ExpressionStatement (ExpressionF a)
simpleStatementFHelper' :: Statement -> SSS (Statement)
simpleStatementFHelper' (SimpleStatement (ExpressionStatement xpr) b) = do
  x <- optimizeExpression xpr Nothing
  _ <- case x of -- Double check this logic -- This needs to be fixed Not 100% sure what this should be?
    (Binary _ "= " (Variable _ var) xprOptimized) -> modify (M.insert var xprOptimized)
    _ -> pure ()
  pure $ (SimpleStatement (ExpressionStatement x) b)
simpleStatementFHelper' (SimpleStatement (VariableDefinition [(VarDefEntry typ loc nam a)] maybeExpression) b) = do
  mExpr <- case maybeExpression of
    Nothing -> pure $ maybeExpression
    Just xpr -> do
      x <- optimizeExpression xpr Nothing
      pure $ Just $ x
  let resVdef = case typ of Just (SVMType.UserDefined _ actual) -> Just actual; _ -> typ --- Unwarp Userdefined types to original type
  -- _ <- case x of --- WTF IS THIS? Oh it puts it in the stack
  --   (Binary _ "= " (Variable _ var) xprOptimized) -> modify (M.insert var xprOptimized); _ -> pure ()
  pure $ (SimpleStatement (VariableDefinition [(VarDefEntry resVdef loc nam a)] mExpr) b)
simpleStatementFHelper' (Return (Just expr) b) = do
  x <- optimizeExpression expr Nothing
  pure $ Return (Just x) b
simpleStatementFHelper' a = pure $ a

_getVariableByName :: SolidString -> SSS (Maybe Expression) --VariableDeclF (SourceAnnotation ()) -- Maybe SVMType.Type
_getVariableByName name = do
  mc <- asks contract
  case mc of
    Just c -> do
      cc <- asks codeCollection
      pure $
        (_constInitialVal <$> M.lookup name (_constants c))
          <|> join (_varInitialVal <$> M.lookup name (_storageDefs c))
          <|> (_constInitialVal <$> M.lookup name (_flConstants cc))
    -- TODO
    -- <|> () <$> M.lookup name (_enums c))
    -- <|> () <$> M.lookup name (_flEnums cc))
    -- <|> () <$> M.lookup name (_flStructs cc))
    -- <|> () <$> M.lookup name (_structs c))
    -- <|> () <$> M.lookup name (_errors c))
    -- <|> () <$> M.lookup name (_flErrors cc))
    Nothing -> do
      mVar <- M.lookup name <$> get
      case mVar of
        Nothing -> pure $ Nothing
        _ -> pure $ mVar

optimizeExpression :: Expression -> Maybe SVMType.Type -> SSS Expression
optimizeExpression (Binary x "=" a b) t = do
  b' <- optimizeExpression b t
  pure $ Binary x "=" a b'
--pure $ Binary x "=" a' b' ---TODO maybe for later fix
--   case (a', b') of
--     (NumberLiteral y valA w, NumberLiteral z valB _) -> pure $ NumberLiteral (y <> z) (valA + valB) w
--     (StringLiteral y valA, StringLiteral z valB) -> pure $ StringLiteral (y <> z) (valA <> valB)
--     _ -> pure $ Binary x "=" a' b'
optimizeExpression (Binary x "+" a b) t = do
  a' <- optimizeExpression a t
  b' <- optimizeExpression b t
  case (a', b') of
    (NumberLiteral y valA w, NumberLiteral z valB _) -> pure $ NumberLiteral (y <> z) (valA + valB) w
    (StringLiteral y valA, StringLiteral z valB) -> pure $ StringLiteral (y <> z) (valA <> valB)
    _ -> pure $ Binary x "+" a' b'
optimizeExpression (Binary x "-" a b) t = do
  a' <- optimizeExpression a t
  b' <- optimizeExpression b t
  case (a', b') of
    (NumberLiteral y valA w, NumberLiteral z valB _) -> pure $ NumberLiteral (y <> z) (valA - valB) w
    _ -> pure $ Binary x "-" a' b'
optimizeExpression (Binary x "*" a b) t = do
  a' <- optimizeExpression a t
  b' <- optimizeExpression b t
  case (a', b') of
    (NumberLiteral y valA w, NumberLiteral z valB _) -> pure $ NumberLiteral (y <> z) (valA * valB) w
    _ -> pure $ Binary x "*" a' b'
optimizeExpression (Binary x "/" a b) t = do
  a' <- optimizeExpression a t
  b' <- optimizeExpression b t
  let varType' = fromMaybe (SVMType.Int Nothing Nothing) t
  case (a', b', varType') of
    (NumberLiteral y valA _, NumberLiteral z valB _, SVMType.Decimal) ->
      if valB == 0
        then pure $ Binary x "/" a' b'
        else pure $ DecimalLiteral (y <> z) $ WrappedDecimal $ roundTo 0 ((Decimal 0 valA) / (Decimal 0 valB))
    (NumberLiteral y valA w, NumberLiteral z valB _, _) ->
      if valB == 0
        then pure $ Binary x "/" a' b'
        else pure $ NumberLiteral (y <> z) (valA `div` valB) w
    _ -> pure $ Binary x "/" a' b'
optimizeExpression (Binary x "%" a b) t = do
  a' <- optimizeExpression a t
  b' <- optimizeExpression b t
  case (a', b') of
    (NumberLiteral y valA w, NumberLiteral z valB _) -> pure $ NumberLiteral (y <> z) (valA `mod` valB) w
    _ -> pure $ Binary x "%" a' b'
optimizeExpression (FunctionCall x1 (MemberAccess x2 (Variable x3 nam) "wrap") args) _ = do
  mc <- asks contract
  case mc of
    Nothing -> pure $ FunctionCall x1 (MemberAccess x2 (Variable x3 nam) "wrap") args
    Just c -> case args of
      [x] | M.member nam (_userDefined c) -> optimizeExpression x Nothing
      _ -> pure (FunctionCall x1 (MemberAccess x2 (Variable x3 nam) "wrap") args)
optimizeExpression (FunctionCall x1 (MemberAccess x2 (Variable x3 nam) "unwrap") args) _ = do
  mc <- asks contract
  case mc of
    Just c -> case args of
      [x] | M.member nam (_userDefined c) -> optimizeExpression x Nothing
      _ -> pure $ FunctionCall x1 (MemberAccess x2 (Variable x3 nam) "unwrap") args
    Nothing -> pure $ FunctionCall x1 (MemberAccess x2 (Variable x3 nam) "unwrap") args

-- This needs further research before letting loose on the code base
-- This function as of now is neutured
-- See git blame for code that was here before
optimizeExpression (Variable x name) _ = pure $ Variable x name

optimizeExpression e _ = pure e
