
{-# LANGUAGE FlexibleContexts #-}

{-# LANGUAGE OverloadedStrings #-}

module SolidVM.Solidity.StaticAnalysis.Optimizer
  ( detector
  ) where

import           Control.Lens
-- import           Control.Applicative ((<|>))
-- import           Control.Arrow ((&&&))
import           Control.Monad.Reader
import           Data.Functor.Compose
import           Data.Maybe (fromMaybe)
import           Data.Map as M
import           SolidVM.Model.CodeCollection
--import           Data.Source

--import           SolidVM.Solidity.StaticAnalysis.Types

--import           SolidVM.Model.Type (Type)
import qualified SolidVM.Model.Type as SVMType
import Debug.Trace
--import SolidVM.Model.SolidString 
import SolidVM.Model.SolidString (SolidString)



data R = R
  { codeCollection :: CodeCollection
  , contract :: Maybe Contract-- Or Contract?
  }


detector ::  CodeCollection -> CodeCollection
detector cc = over (contracts . mapped) (contractHelper cc)
          $ over (flFuncs . mapped) (functionHelper cc  Nothing)
          $ over (flConstants . mapped) (constDeclHelper cc Nothing) cc

contractHelper :: CodeCollection
               -> Contract
               -> Contract
contractHelper cc c = (constructor . _Just %~ functionHelper cc (Just c))
              $ over (storageDefs . mapped) (varDeclHelper   cc (Just c))
              $ over (functions . mapped)   (functionHelper  cc (Just c))
              $ over (constants . mapped)   (constDeclHelper cc (Just c)) c


varDeclHelper :: CodeCollection
              -> Maybe Contract
              -> VariableDecl
              -> VariableDecl
varDeclHelper cc c v = case varType v of
  (SVMType.UserDefined  al actua )-> v{varType = actua  ,varInitialVal = run2 al actua<$> varInitialVal v }
  _ -> v{ varInitialVal = run <$> varInitialVal v }
  where run e = let r = R cc c
          in runReader (optimizeExpression e) r
        run2 a t e = let r = R cc c
          in runReader (optimizeExpressionUserDefined a t e) r


constDeclHelper :: CodeCollection
                -> Maybe Contract
                -> ConstantDecl
                -> ConstantDecl
constDeclHelper cc c v = v{ constInitialVal = run $ constInitialVal v }
  where run e = let r = R cc c-- Todo Make this an actual contract
                 in runReader (optimizeExpression e) r


-- Clean This code up
functionHelper :: CodeCollection
               -> Maybe Contract
               -> Func
               -> Func
functionHelper cc mc f = do

  case funcContents f of
    Nothing -> f
    Just stmts -> do
      case mc of 
        Just c ->  
          if M.null $ _userDefined c -- Check if there is any user Defined
            then
              let r = R cc mc
              in f{ 
                funcContents = Just $ runReader (optimizeStatements stmts) r }
            else
              let r = R cc mc
              in functionHelperForUserDefined f{ 
                funcContents = Just $ runReader (optimizeStatements stmts) r }
        Nothing -> let r = R cc mc
              in f{ 
                funcContents = Just $ runReader (optimizeStatements stmts) r }

-- Throw a if statement before this.
-- Way smarter way of writing this.
functionHelperForUserDefined ::  Func -> Func
functionHelperForUserDefined f = f{ funcArgs =  tForm  $ funcArgs f, funcVals =  tForm  $ funcVals f   }
  where 
    tForm :: [(Maybe SolidString, IndexedType)] -> [(Maybe SolidString, IndexedType)]
    tForm = Prelude.map (\(maybeSoldString, (IndexedType z y) ) -> case (maybeSoldString, y) of
      (xxxx, (SVMType.UserDefined _ act)) -> (xxxx, (IndexedType z act))
      (xxxx, _ )-> (xxxx, (IndexedType z y));
      )


optimizeStatements :: [Statement] -> Reader R [Statement]
optimizeStatements [] = pure []
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
      (IfStatement cond' thens' elses' x:) <$> optimizeStatements ss
optimizeStatements ((TryCatchStatement tryStatements catchMap x) : ss) = do
  tryStatements' <- optimizeStatements tryStatements
  catchMap' <- getCompose <$> traverse optimizeStatements (Compose catchMap)
  (TryCatchStatement tryStatements' catchMap' x:) <$> optimizeStatements ss
optimizeStatements ((SolidityTryCatchStatement expr mtpl successStatements catchMap x) : ss) = do
  expr' <- optimizeExpression expr
  successStatements' <- optimizeStatements successStatements
  catchMap' <- getCompose <$> traverse optimizeStatements (Compose catchMap)
  (SolidityTryCatchStatement expr' mtpl successStatements' catchMap' x:) <$> optimizeStatements ss
optimizeStatements ((WhileStatement cond body x) : ss) = do
  cond' <- optimizeExpression cond
  case cond' of
    BoolLiteral _ False -> optimizeStatements ss
    _ -> do
      body' <- optimizeStatements body
      (WhileStatement cond' body' x:) <$> optimizeStatements ss
optimizeStatements ((ForStatement mInit mCond mPost body x) : ss) = do
  mCond' <- traverse optimizeExpression mCond
  mPost' <- traverse optimizeExpression mPost
  body' <- optimizeStatements body
  (ForStatement mInit mCond' mPost' body' x:) <$> optimizeStatements ss
optimizeStatements ((Block _) : ss) = optimizeStatements ss
optimizeStatements ((DoWhileStatement body cond x) : ss) = do
  body' <- optimizeStatements body
  cond' <- optimizeExpression cond
  case cond' of
    BoolLiteral _ False -> (body' ++) <$> optimizeStatements ss
    _ -> (DoWhileStatement body' cond' x:) <$> optimizeStatements ss
optimizeStatements (s@(Continue _) : _) = pure [s]
optimizeStatements (s@(Break _) : _) = pure [s]
optimizeStatements (s@(Return _ _) : _) = pure [s]
optimizeStatements (s@(Throw _ _) : _) = pure [s]
optimizeStatements (s@(ModifierExecutor _) : ss) = (s:) <$> optimizeStatements ss
optimizeStatements (s@(EmitStatement {}) : ss) = (s:) <$> optimizeStatements ss
optimizeStatements (s@(RevertStatement {}) : _) = pure [s]
optimizeStatements (s@(UncheckedStatement _ _) : ss) = (s:) <$> optimizeStatements ss
optimizeStatements (s@(AssemblyStatement _ _) : ss) = (s:) <$> optimizeStatements ss
optimizeStatements (s@(SimpleStatement _ _) : ss) = (s:) <$> optimizeStatements ss


optimizeExpressionUserDefined :: String -> SVMType.Type -> Expression -> Reader R Expression
--optimizeExpressionUserDefined aliasName actualType e = do
optimizeExpressionUserDefined aliasName actualType e = do
  res <- case e of
    (FunctionCall _  (MemberAccess _  (Variable _  _ ) "wrap") (OrderedArgs [x])) ->  optimizeExpression x
    _ -> optimizeExpression e  --- Need to test this more and throw errors about this

  cc <-  asks codeCollection
  c <-  asks contract
  let printTHis = (case c of 
        Just rC -> trace ("\n\n\t Trace Print in UserDEfined Expression" ++
                "Ordered args\t" ++show e++
                "\ncc\t" ++ show (_contracts cc) ++
                "\n\n\nfunctions \t" ++ (show (M.lookup "f" $ _functions rC)) ++
                "\nAlais\t" ++ show aliasName ++
                "\nActual\t" ++ show actualType
                ) "\n"
        _ -> "ehh"
        )

  pure $ trace printTHis res


-- As of right now this is just a helper for UserDefined types.
-- This needs to be altered fore all Types down the road. 
getVariableByName :: SolidString -> Reader R  (Maybe Expression)--VariableDeclF (SourceAnnotation ()) -- Maybe SVMType.Type 
getVariableByName name = do
  mc <- asks contract
  case mc of 
    Just c -> do
      --cc <- asks codeCollection
      let mVarDecl = (M.lookup name (_storageDefs c))
                  -- <|> ( M.lookup name (_constants c))
                  -- <|> ( M.lookup name (_flConstants cc))
      case mVarDecl of
        Just (VariableDecl (SVMType.UserDefined  _ _ ) _ vi _  _) ->  pure $   vi --(SVMType.UserDefined  al actua ) 
        Just (VariableDecl _ _ vi _  _) ->  pure $   vi
        Nothing ->  pure $  Nothing
    Nothing ->  pure $  Nothing

-- userDefinedToExpression :: SVMType.UserDefined -> Expression -> Expression
-- userDefinedToExpression (SVMType.UserDefined  al actua ) ogExpr = 
--   optExpr <- optimizeExpression ogExpr
--   case actua of 



--I probably should come up with an expression maker that turns a UserDefined into a OG type

--Can throw away
-- userTypeHelper' :: Maybe String -> ExpressionF
-- userTypeHelper' (Just "bool")   =  SVMType.Bool
-- userTypeHelper' (Just "string") =  StringLiteral a String
-- userTypeHelper' (Just "int")    =  NumberLiteral 
-- userTypeHelper' (Just "uint")   =  NumberLiteral
-- userTypeHelper' (Just "bytes")  =  NumberLiteral
-- userTypeHelper' (Just "byte")   =  NumberLiteral 
-- userTypeHelper' _               =  SVMType.Bool  --TODO fix this

optimizeExpression :: Expression -> Reader R Expression
optimizeExpression (Binary x "+" a b) = do
  a'' <- optimizeExpression a
  --a' <- optimizeExpression a
  let printThing  = trace ("\n\n\t" ++ show a'' ++ "\n\n\t") ( optimizeExpression a) --get rid of this
  a' <- printThing --get ride of this 
  b' <- optimizeExpression b
  case (a', b') of
    (NumberLiteral y valA w, NumberLiteral z valB _) -> pure $ NumberLiteral (y <> z) (valA + valB) w
    (StringLiteral y valA, StringLiteral z valB) -> pure $ StringLiteral (y <> z) (valA <> valB)
    --(StringLiteral y valA, StringLiteral z valB)
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
optimizeExpression (FunctionCall x1  (MemberAccess x2  (Variable x3  nam) "wrap") args) = do
  mc <- asks contract
  case mc of 
    Just c -> do 
      let arg = case args of OrderedArgs es ->  es;  _ -> [];
      if M.member nam (_userDefined  c) &&   length arg == 1
        then do
          optimizeExpression $ head arg
        else pure (FunctionCall x1  (MemberAccess x2  (Variable x3  nam) "wrap") args)
    Nothing -> do 
      pure $ (FunctionCall x1  (MemberAccess x2  (Variable x3  nam) "wrap") args)


optimizeExpression (FunctionCall x1  (MemberAccess x2  (Variable x3  nam) "unwrap") args) = do
  --Basically an unwrap returns the underlying of the userDefined type.
  -- That means we need a optimizeExpression that takes a UserDefined
  mc <- asks contract
  case mc of 
    Just c -> do 
      let arg = case args of OrderedArgs es ->  es;  _ -> [];
      if M.member nam (_userDefined  c) &&   length arg == 1
        then do
          case head arg of 
            (Variable _ name) -> do
              mExpr  <- getVariableByName name
              case mExpr of
                Just expr -> optimizeExpression expr
                _ -> pure $ (FunctionCall x1  (MemberAccess x2  (Variable x3  nam) "wrap") args)
            _ -> optimizeExpression $ head arg
        else pure (FunctionCall x1  (MemberAccess x2  (Variable x3  nam) "wrap") args)
    Nothing -> do 
      pure $ (FunctionCall x1  (MemberAccess x2  (Variable x3  nam) "wrap") args)

optimizeExpression e = pure e
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
-- optimizeExpression (MemberAccess _ a fieldName) = do
--   t <- optimizeExpression a
--   typecheckMember t fieldName
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
