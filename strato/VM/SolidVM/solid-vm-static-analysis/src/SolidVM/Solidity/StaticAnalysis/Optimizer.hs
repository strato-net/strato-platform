{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-} 
module SolidVM.Solidity.StaticAnalysis.Optimizer
  ( detector
  ) where

import           Control.Monad.Reader
import           Control.Lens
import           Data.Map as M
import           Data.Functor.Compose
import           Data.Maybe (fromMaybe)

import           SolidVM.Model.CodeCollection
import           SolidVM.Solidity.Parse.UnParser

--import           Blockchain.SolidVM.Exception

data R = R
  { codeCollection :: CodeCollection
  }


detector ::  CodeCollection -> CodeCollection
detector cc = (over (contracts . mapped) (contractHelper cc))
          $ over (flFuncs . mapped) (functionHelper cc)
          $ over (flConstants . mapped) (constDeclHelper cc) cc 

contractHelper :: CodeCollection 
               -> Contract
               -> Contract
contractHelper cc = (constructor . _Just %~ (functionHelper cc) )
               . over (storageDefs . mapped) (varDeclHelper cc)
               . over (functions . mapped) (functionHelper cc)
               . over (constants . mapped) (constDeclHelper cc) 
  

varDeclHelper :: CodeCollection
              -> VariableDecl
              -> VariableDecl
varDeclHelper cc v = v{ _varInitialVal = run <$> _varInitialVal v }
  where run e = let r = R (cc)
          in runReader (optimizeExpression e) r

constDeclHelper :: CodeCollection
                -> ConstantDecl
                -> ConstantDecl
constDeclHelper cc v = v{ _constInitialVal = run $ _constInitialVal v }
  where run e = let r = R (cc)

                 in runReader (optimizeExpression e) r

functionHelper :: CodeCollection
               -> Func
               -> Func
functionHelper cc f = case _funcContents f of
  Nothing -> f
  Just stmts ->
    let r = R (cc)
     in f{ _funcContents = Just $ runReader (optimizeStatements stmts) r }

optimizeStatements :: [Statement] -> Reader R [Statement]
optimizeStatements [] = pure $  []
optimizeStatements ((IfStatement cond thens mElse x) : ss) = do
  cond' <- optimizeExpression cond
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
      ((IfStatement cond' thens' elses' x):) <$> optimizeStatements ss
optimizeStatements ((TryCatchStatement tryStatements catchMap x) : ss) = do
  tryStatements' <- optimizeStatements tryStatements
  catchMap' <- getCompose <$> traverse optimizeStatements (Compose catchMap)
  ((TryCatchStatement tryStatements' catchMap' x):) <$> optimizeStatements ss
optimizeStatements ((SolidityTryCatchStatement expr mtpl successStatements catchMap x) : ss) = do
  expr' <- optimizeExpression expr
  successStatements' <- optimizeStatements successStatements
  catchMap' <- getCompose <$> traverse optimizeStatements (Compose catchMap)
  ((SolidityTryCatchStatement expr' mtpl successStatements' catchMap' x):) <$> optimizeStatements ss
optimizeStatements ((WhileStatement cond body x) : ss) = do
  cond' <- optimizeExpression cond
  case cond' of
    BoolLiteral _ False -> optimizeStatements ss
    _ -> do
      body' <- optimizeStatements body
      ((WhileStatement cond' body' x):) <$> optimizeStatements ss
optimizeStatements ((ForStatement mInit mCond mPost body x) : ss) = do
  mCond' <- traverse optimizeExpression mCond
  mPost' <- traverse optimizeExpression mPost
  body' <- optimizeStatements body
  ((ForStatement mInit mCond' mPost' body' x):) <$> optimizeStatements ss
optimizeStatements ((Block _) : ss) = optimizeStatements ss
optimizeStatements ((DoWhileStatement body cond x) : ss) = do
  body' <- optimizeStatements body
  cond' <- optimizeExpression cond
  case cond' of
    BoolLiteral _ False -> (body' ++) <$> optimizeStatements ss
    _ -> ((DoWhileStatement body' cond' x):) <$> optimizeStatements ss
optimizeStatements (s@(Continue _) : _) = pure [s]
optimizeStatements (s@(Break _) : _) = pure [s]
optimizeStatements (s@(Return _ _) : _) = pure [s]
optimizeStatements (s@(Throw _ _) : _) = pure [s]
optimizeStatements (s@(ModifierExecutor _) : ss) = (s:) <$> optimizeStatements ss
optimizeStatements (s@(EmitStatement _ _ _) : ss) = (s:) <$> optimizeStatements ss
optimizeStatements (s@(RevertStatement _ _ _) : _) = pure [s]
optimizeStatements (s@(UncheckedStatement _ _) : ss) = (s:) <$> optimizeStatements ss
optimizeStatements (s@(AssemblyStatement _ _) : ss) = (s:) <$> optimizeStatements ss
optimizeStatements (s@(SimpleStatement _ _) : ss) = (s:) <$> optimizeStatements ss

optimizeExpression :: Expression -> Reader R Expression
optimizeExpression (Binary x "+" a b) = do
  a' <- optimizeExpression a
  b' <- optimizeExpression b
  case (a', b') of
    (NumberLiteral y valA w, NumberLiteral z valB _) -> pure $ NumberLiteral (y <> z) (valA + valB) w
    (StringLiteral y valA, StringLiteral z valB) -> pure $ StringLiteral (y <> z) (valA <> valB)
    _ -> pure $ Binary x "+" a' b'
optimizeExpression (Binary x "-" a b) = do
  a' <- optimizeExpression a
  b' <- optimizeExpression b
  case (a', b') of
    (NumberLiteral y valA w, NumberLiteral z valB _) -> pure $ NumberLiteral (y <> z) (valA - valB) w
    _ -> pure $ Binary x "-" a' b'
optimizeExpression (Binary x "*" a b) = do
  a' <- optimizeExpression a
  b' <- optimizeExpression b
  case (a', b') of
    (NumberLiteral y valA w, NumberLiteral z valB _) -> pure $ NumberLiteral (y <> z) (valA * valB) w
    _ -> pure $ Binary x "*" a' b'
optimizeExpression (Binary x "/" a b) = do
  a' <- optimizeExpression a
  b' <- optimizeExpression b
  case (a', b') of
    (NumberLiteral y valA w, NumberLiteral z valB _) -> pure $ NumberLiteral (y <> z) (valA `div` valB) w
    _ -> pure $ Binary x "/" a' b'
optimizeExpression (Binary x "%" a b) = do
  a' <- optimizeExpression a
  b' <- optimizeExpression b
  case (a', b') of
    (NumberLiteral y valA w, NumberLiteral z valB _) -> pure $ NumberLiteral (y <> z) (valA `mod` valB) w
    _ -> pure $ Binary x "%" a' b'
-- optimizeExpression (Binary x "|" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b
-- optimizeExpression (Binary x "&" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b
-- optimizeExpression (Binary x "^" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b
-- optimizeExpression (Binary x "**" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b
-- optimizeExpression (Binary x "<<" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b
-- optimizeExpression (Binary x ">>" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b
-- optimizeExpression (Binary x ">>>" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b
-- optimizeExpression (Binary x ">>>=" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b
-- optimizeExpression (Binary x ">>=" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b
-- optimizeExpression (Binary x "<<=" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b
-- optimizeExpression (Binary x "+=" a b) =
--   sumType' (intType' x) (stringType' x)  ~> (checkIfImmuteOperationValid a) <~> optimizeExpression b
-- optimizeExpression (Binary x "-=" a b) =
--   intType' x ~> (checkIfImmuteOperationValid a) <~> optimizeExpression b
-- optimizeExpression (Binary x "*=" a b) =
--   intType' x ~> (checkIfImmuteOperationValid a) <~> optimizeExpression b
-- optimizeExpression (Binary x "/=" a b) =
--   intType' x ~> (checkIfImmuteOperationValid a) <~> optimizeExpression b
-- optimizeExpression (Binary x "%=" a b) =
--   intType' x ~> (checkIfImmuteOperationValid a) <~> optimizeExpression b
-- optimizeExpression (Binary x "|=" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b
-- optimizeExpression (Binary x "&=" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b
-- optimizeExpression (Binary x "^=" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b
-- optimizeExpression (Binary x "||" a b) =
--   boolType' x ~> optimizeExpression a <~> optimizeExpression b
-- optimizeExpression (Binary x "&&" a b) =
--   boolType' x ~> optimizeExpression a <~> optimizeExpression b
-- optimizeExpression (Binary x "!=" a b) =
--   optimizeExpression a <~> optimizeExpression b !> pure (boolType' x)
-- optimizeExpression (Binary x "==" a b) =
--   optimizeExpression a <~> optimizeExpression b !> pure (boolType' x)
-- optimizeExpression (Binary x "<" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b !> pure (boolType' x)
-- optimizeExpression (Binary x ">" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b !> pure (boolType' x)
-- optimizeExpression (Binary x ">=" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b !> pure (boolType' x)
-- optimizeExpression (Binary x "<=" a b) =
--   intType' x ~> optimizeExpression a <~> optimizeExpression b !> pure (boolType' x)
-- optimizeExpression (Binary _ "=" a b) =
--   (checkIfImmuteOperationValid a) <~> optimizeExpression b
-- optimizeExpression (Binary _ _ a b) = 
--   (optimizeExpression a <~> optimizeExpression b)
-- optimizeExpression (PlusPlus x a) = 
--   intType' x ~> optimizeExpression a
-- optimizeExpression (MinusMinus x a) = do
--   intType' x ~> optimizeExpression a
-- optimizeExpression (NewExpression x b@SVMType.Bytes{}) = pure $ Static b x
-- optimizeExpression (NewExpression x a@SVMType.Array{}) = pure $ Static a x
-- optimizeExpression (NewExpression x (SVMType.UnknownLabel l _)) = getConstructorType' x l
-- optimizeExpression (NewExpression x (SVMType.Contract l)) = getConstructorType' x l
-- optimizeExpression (NewExpression x t) = pure . bottom $ ("Cannot use keyword 'new' in conjuction with type " <> showType t) <$ x
-- optimizeExpression (IndexAccess _ a (Just b)) = do
--   a' <- optimizeExpression a
--   b' <- optimizeExpression b
--   typecheckIndex a' b'
-- optimizeExpression (IndexAccess _ a Nothing) = optimizeExpression a
optimizeExpression (MemberAccess loc base fieldName) = do
  case base of 
    (FunctionCall spot (Variable _ "type") (OrderedArgs [(Variable _ nam)])) -> do --Note type is a special reserved function
        cc <- asks codeCollection
        if (M.member nam (_contracts cc) )
        then case fieldName of 
          "name" -> pure $ (StringLiteral spot nam)
          --"int"  -> pure $ ()--To Implement for another ticket
          "creationCode" -> pure $ case M.lookup nam (_contracts cc) of Just contract -> (StringLiteral spot (unparseContract  contract));  _ ->  (MemberAccess loc base fieldName); 
          "runtimeCode" -> pure $ (MemberAccess loc base fieldName)
          _ -> pure $ (MemberAccess loc base fieldName) 
        else  pure $ (MemberAccess loc base fieldName)
    (FunctionCall _ (Variable _ "type") (NamedArgs _)) -> pure $ (MemberAccess loc base fieldName) 
    _  -> pure $ (MemberAccess loc base fieldName) -- TODO implement a memeber Access evaluator
      -- b <- optimizeExpression  base
      -- t <- optimizeExpression  (b fieldName)
      
-- optimizeExpression (FunctionCall x expr args) = do
--   e <- optimizeExpression expr
--   a <- case args of
--          OrderedArgs es -> productType' x <$> traverse optimizeExpression es
--          NamedArgs es -> productType' x <$> traverse (optimizeExpression . snd) es
--   apply e a
-- optimizeExpression (Unitary x "-" a) = intType' x ~> optimizeExpression a
-- optimizeExpression (Unitary x "++" a) = intType' x ~> optimizeExpression a
-- optimizeExpression (Unitary x "--" a) = intType' x ~> optimizeExpression a
-- optimizeExpression (Unitary x "!" a) = boolType' x ~> optimizeExpression a
-- optimizeExpression (Unitary x "delete" a) = optimizeExpression a !> pure (Product [] x)
-- optimizeExpression (Unitary _ _ a) = optimizeExpression a
-- optimizeExpression (Ternary x a b c) =
--    boolType' x ~> optimizeExpression a !> optimizeExpression b <~> optimizeExpression c
-- optimizeExpression (BoolLiteral x _) = pure $ boolType' x
-- optimizeExpression (NumberLiteral x _ _) = pure $ intType' x
-- optimizeExpression (StringLiteral x _) = pure $ stringType' x
-- optimizeExpression (TupleExpression x es) =
--   productType' x <$> traverse (maybe (pure $ topType' x) optimizeExpression) es
-- optimizeExpression (ArrayExpression x es) = do
--   t' <- foldr (<~>) (pure $ topType' x) $ optimizeExpression <$> es
--   pure $ case t' of
--     (Static t _) -> Static (SVMType.Array t Nothing) x
--     _ -> t'
-- optimizeExpression (Variable x name) = getVarType' (labelToString name) x
-- optimizeExpression (ObjectLiteral x _) = pure . bottom $ "Cannot use object literals within contract definitions" <$ x
optimizeExpression e = pure e