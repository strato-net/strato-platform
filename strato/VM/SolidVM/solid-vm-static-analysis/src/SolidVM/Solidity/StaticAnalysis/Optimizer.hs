{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}

module SolidVM.Solidity.StaticAnalysis.Optimizer
  ( detector,
    varDeclHelper,
  )
where

import Control.Applicative ((<|>))
import Control.Lens
import Control.Monad.Reader
import Control.Monad.Trans.State
import Data.Decimal
import Data.Foldable (for_)
import Data.Functor.Compose
import qualified Data.Map as M
import Data.Maybe (catMaybes, fromMaybe)
import Data.Source.Annotation
import SolidVM.Model.CodeCollection
import SolidVM.Model.SolidString (SolidString)
import qualified SolidVM.Model.Type as SVMType

data R = R
  { codeCollection :: CodeCollection,
    contract :: Maybe Contract
  }

type SSS = StateT ([M.Map SolidString SVMType.Type], Bool) (Reader R) -- Is there a better data structure for this job?

runSSS :: R -> M.Map SolidString SVMType.Type -> SSS a -> a
runSSS r m f = runReader (evalStateT f ([m], False)) r

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
       in runSSS r M.empty $ optimizeExpression e (Just t)

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
       in runSSS r M.empty $ optimizeExpression e Nothing

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
      let swap (a,b) = (b,a)
          args =
            ( \(it, n) ->
                ( n,
                  VarDefEntry (Just $ indexedTypeType it) Nothing n $ _funcContext f
                )
            )
              <$> (catMaybes $ sequence . swap <$> _funcArgs f)
          vals =
            ( \(it, n) ->
                ( n,
                  VarDefEntry (Just $ indexedTypeType it) Nothing n $ _funcContext f
                )
            )
              <$> (catMaybes $ sequence . swap <$> _funcVals f)
          argVals = M.fromList $ args ++ vals
          argTypes = M.fromList . catMaybes . flip map (M.toList argVals) $ \(k,v) -> case v of
              VarDefEntry mType _ _ _ -> (k,) <$> mType
              _ -> Nothing
       in if ((Just True) ==) $ M.null <$> (_userDefined <$> mc)
            then
              let r = R cc mc
               in f {_funcContents = Just $ runSSS r argTypes $ optimizeStatements stmts}
            else
              let r = R cc mc
               in functionHelperForUserDefined f {_funcContents = Just $
                      runSSS r argTypes $ optimizeStatements stmts
                    }

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

pushVar :: String -> SVMType.Type -> SSS ()
pushVar n t = modify $ \(ms',uc) -> case ms' of
  [] -> ([], uc)
  (m:ms) -> ((M.insert n t m):ms, uc)

getVar :: String -> SSS (Maybe SVMType.Type)
getVar n = foldr (\a b -> M.lookup n a <|> b) Nothing <$> gets fst

withFrame :: SSS a -> SSS a
withFrame f = do
  modify $ \(ms,uc) -> (M.empty:ms, uc)
  a <- f
  modify (\case
      ((_:xs), uc) -> (xs, uc)
      s -> s
    )
  pure a

withUnchecked :: SSS a -> SSS a
withUnchecked f = do
  currentCheckedness <- gets snd
  modify $ \(ms,_) -> (ms, True)
  a <- f
  modify $ \(ms,_) -> (ms, currentCheckedness)
  pure a

checkIntBounds ::
  Maybe Bool ->
  Maybe Integer ->
  Maybe Integer ->
  a ->
  String ->
  ExpressionF a ->
  SSS (ExpressionF a)
checkIntBounds s mL mU b var expr = gets snd >>= \uc -> getVariableByName var >>= \case
  Just (SVMType.Int s' _) | not uc && fromMaybe True ((==) <$> s <*> s') ->
    pure $ InlineBoundsCheck b mL mU expr
  _ -> pure expr

checkUintUnderflow :: a -> String -> ExpressionF a -> SSS (ExpressionF a)
checkUintUnderflow = checkIntBounds (Just False) (Just 0) Nothing

optimizeStatements :: [Statement] -> SSS [Statement]
optimizeStatements [] = pure []
optimizeStatements ((IfStatement cond thens mElse x) : ss) = do
  cond' <- optimizeExpression cond Nothing
  case cond' of
    BoolLiteral _ True -> do
      thens' <- withFrame $ optimizeStatements thens
      (thens' ++) <$> optimizeStatements ss
    BoolLiteral _ False -> do
      elses' <- withFrame . optimizeStatements $ fromMaybe [] mElse
      (elses' ++) <$> optimizeStatements ss
    _ -> do
      thens' <- withFrame $ optimizeStatements thens
      elses' <- withFrame $ traverse optimizeStatements mElse
      (IfStatement cond' thens' elses' x :) <$> optimizeStatements ss
optimizeStatements ((TryCatchStatement tryStatements catchMap x) : ss) = do
  tryStatements' <- withFrame $ optimizeStatements tryStatements
  catchMap' <- getCompose <$> traverse (withFrame . optimizeStatements) (Compose catchMap)
  (TryCatchStatement tryStatements' catchMap' x :) <$> optimizeStatements ss
optimizeStatements ((SolidityTryCatchStatement expr mtpl successStatements catchMap x) : ss) = do
  expr' <- optimizeExpression expr Nothing
  successStatements' <- withFrame $ optimizeStatements successStatements
  catchMap' <- getCompose <$> traverse (withFrame . optimizeStatements) (Compose catchMap)
  (SolidityTryCatchStatement expr' mtpl successStatements' catchMap' x :) <$> optimizeStatements ss
optimizeStatements ((WhileStatement cond body x) : ss) = do
  cond' <- optimizeExpression cond Nothing
  case cond' of
    BoolLiteral _ False -> optimizeStatements ss
    _ -> do
      body' <- withFrame $ optimizeStatements body
      (WhileStatement cond' body' x :) <$> optimizeStatements ss
optimizeStatements ((ForStatement mInit mCond mPost body x) : ss) = do
  let getExpression = (\xxx -> optimizeExpression xxx Nothing)
  mCond' <- traverse getExpression mCond
  mPost' <- traverse getExpression mPost
  body' <- withFrame $ optimizeStatements body
  (ForStatement mInit mCond' mPost' body' x :) <$> optimizeStatements ss
optimizeStatements ((Block _) : ss) = optimizeStatements ss
optimizeStatements ((DoWhileStatement body cond x) : ss) = do
  body' <- withFrame $ optimizeStatements body
  cond' <- optimizeExpression cond Nothing
  case cond' of
    BoolLiteral _ False -> (body' ++) <$> optimizeStatements ss
    _ -> (DoWhileStatement body' cond' x :) <$> optimizeStatements ss
optimizeStatements (s@(Continue _) : _) = pure [s]
optimizeStatements (s@(Break _) : _) = pure [s]
optimizeStatements (s@(Throw _ _) : _) = pure [s]
optimizeStatements (s@(ModifierExecutor _) : ss) = (s :) <$> optimizeStatements ss
optimizeStatements (s@(EmitStatement {}) : ss) = (s :) <$> optimizeStatements ss
optimizeStatements (s@(RevertStatement {}) : _) = pure [s]
optimizeStatements (UncheckedStatement uss x : ss) = do
  uss' <- withUnchecked $ optimizeStatements uss
  (UncheckedStatement uss' x:) <$> optimizeStatements ss
optimizeStatements (s@(AssemblyStatement _ _) : ss) = (s :) <$> optimizeStatements ss
optimizeStatements (s@(SimpleStatement _ _) : ss) = do
  simpleStatementOptimized <- simpleStatementFHelper' s
  (simpleStatementOptimized :) <$> optimizeStatements ss
optimizeStatements (s@(Return (Just _) _) : ss) = do
  ssss <- simpleStatementFHelper' s
  (ssss :) <$> optimizeStatements ss
optimizeStatements (s@(Return _ _) : _) = pure [s]

-- Note two cases for simple statement:
-- 1. VariableDefinition [VarDefEntryF a] (Maybe (ExpressionF a))
-- 2. ExpressionStatement (ExpressionF a)
simpleStatementFHelper' :: Statement -> SSS (Statement)
simpleStatementFHelper' (SimpleStatement (ExpressionStatement xpr) b) = do
  x <- optimizeExpression xpr Nothing
  pure $ (SimpleStatement (ExpressionStatement x) b)
simpleStatementFHelper' (SimpleStatement (VariableDefinition [(VarDefEntry typ loc nam a)] maybeExpression) b) = do
  for_ typ $ pushVar nam
  mExpr <- traverse (flip optimizeExpression Nothing) maybeExpression
  let resVdef = case typ of Just (SVMType.UserDefined _ actual) -> Just actual; _ -> typ --- Unwarp Userdefined types to original type
  -- _ <- case x of --- WTF IS THIS? Oh it puts it in the stack
  --   (Binary _ "= " (Variable _ var) xprOptimized) -> modify (M.insert var xprOptimized); _ -> pure ()
  mExpr' <- traverse (checkUintUnderflow a nam) mExpr
  pure $ SimpleStatement (VariableDefinition [(VarDefEntry resVdef loc nam a)] mExpr') b
simpleStatementFHelper' (Return (Just expr) b) = do
  x <- optimizeExpression expr Nothing
  pure $ Return (Just x) b
simpleStatementFHelper' a = pure a

getVariableByName :: SolidString -> SSS (Maybe SVMType.Type) --VariableDeclF (SourceAnnotation ()) -- Maybe SVMType.Type
getVariableByName name = do
  mVar <- getVar name
  case mVar of
    Just t -> pure $ Just t
    Nothing -> do
      mc <- asks contract
      case mc of
        Just c -> do
          cc <- asks codeCollection
          pure $
            (_constType <$> M.lookup name (_constants c))
              <|> (_varType <$> M.lookup name (_storageDefs c))
              <|> (_constType <$> M.lookup name (_flConstants cc))
        Nothing -> pure Nothing
        -- TODO
        -- <|> () <$> M.lookup name (_enums c))
        -- <|> () <$> M.lookup name (_flEnums cc))
        -- <|> () <$> M.lookup name (_flStructs cc))
        -- <|> () <$> M.lookup name (_structs c))
        -- <|> () <$> M.lookup name (_errors c))
        -- <|> () <$> M.lookup name (_flErrors cc))

optimizeSetter ::
  Maybe SVMType.Type ->
  SourceAnnotation () ->
  String ->
  Expression ->
  Expression ->
  SSS Expression
optimizeSetter t z op' lhs rhs = do
  lhs' <- optimizeExpression lhs t
  rhs' <- optimizeExpression rhs t
  optimizeExpression (Binary z "=" lhs' $ Binary z op' lhs' rhs') t

optimizeExpression :: Expression -> Maybe SVMType.Type -> SSS Expression
optimizeExpression (Binary x "=" a b) t = do
  b' <- optimizeExpression b t
  case a of
    Variable x' a' -> Binary x "=" a <$> checkUintUnderflow x' a' b'
    _ -> pure $ Binary x "=" a b'
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
optimizeExpression (Binary     z "+=" lhs rhs) t = optimizeSetter t z "+" lhs rhs
optimizeExpression (Binary     z "-=" lhs rhs) t = optimizeSetter t z "-" lhs rhs
optimizeExpression (Binary     z "*=" lhs rhs) t = optimizeSetter t z "*" lhs rhs
optimizeExpression (Binary     z "/=" lhs rhs) t = optimizeSetter t z "/" lhs rhs
optimizeExpression (Binary     z "%=" lhs rhs) t = optimizeSetter t z "%" lhs rhs
optimizeExpression (Binary     z "&=" lhs rhs) t = optimizeSetter t z "&" lhs rhs
optimizeExpression (Binary     z "|=" lhs rhs) t = optimizeSetter t z "|" lhs rhs
optimizeExpression (Binary     z "^=" lhs rhs) t = optimizeSetter t z "^" lhs rhs
optimizeExpression (Unitary    z "++" lhs    ) t = optimizeSetter t z "+" lhs (NumberLiteral z 1 Nothing)
optimizeExpression (Unitary    z "--" lhs    ) t = optimizeSetter t z "-" lhs (NumberLiteral z 1 Nothing)
optimizeExpression (MinusMinus z      expr   ) t = optimizeExpression expr t >>= \case
  Variable x var -> MinusMinus z <$> checkIntBounds (Just False) (Just 1) Nothing x var (Variable x var)
  expr' -> pure $ MinusMinus z expr'
optimizeExpression (PlusPlus z      expr   ) t = optimizeExpression expr t >>= \case
  Variable x var -> PlusPlus z <$> checkIntBounds (Just False) (Just (-1)) Nothing x var (Variable x var)
  expr' -> pure $ PlusPlus z expr'
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

optimizeExpression e@(Variable x name) _ = checkUintUnderflow x name e
optimizeExpression (Unitary x s a) z = Unitary x s
                                   <$> optimizeExpression a z
optimizeExpression (Binary x s a b) z = Binary x s
                                    <$> optimizeExpression a z
                                    <*> optimizeExpression b z
optimizeExpression (IndexAccess x e mI) z = IndexAccess x
                                        <$> optimizeExpression e z
                                        <*> traverse (flip optimizeExpression z) mI
optimizeExpression (MemberAccess x e m) z = MemberAccess x
                                        <$> optimizeExpression e z
                                        <*> pure m
optimizeExpression (FunctionCall x f a) z = FunctionCall x
                                        <$> optimizeExpression f z
                                        <*> pure a
optimizeExpression (Ternary x a b c) z = Ternary x
                                        <$> optimizeExpression a z
                                        <*> optimizeExpression b z
                                        <*> optimizeExpression c z
optimizeExpression (TupleExpression x mes) z = TupleExpression x
                                           <$> traverse (traverse (flip optimizeExpression z)) mes
optimizeExpression (ArrayExpression x es) z = ArrayExpression x
                                          <$> traverse (flip optimizeExpression z) es
optimizeExpression (ObjectLiteral x m) z = ObjectLiteral x
                                       <$> traverse (flip optimizeExpression z) m
--  Keeping each case explicitly listed here, so that none are accidentally forgotten in the future
optimizeExpression e@NewExpression{}     _ = pure e
optimizeExpression e@BoolLiteral{}       _ = pure e
optimizeExpression e@NumberLiteral{}     _ = pure e
optimizeExpression e@DecimalLiteral{}    _ = pure e
optimizeExpression e@StringLiteral{}     _ = pure e
optimizeExpression e@AccountLiteral{}    _ = pure e
optimizeExpression e@HexaLiteral{}       _ = pure e
optimizeExpression e@InlineBoundsCheck{} _ = pure e