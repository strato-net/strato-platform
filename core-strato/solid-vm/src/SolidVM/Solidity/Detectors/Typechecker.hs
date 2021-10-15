{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
module SolidVM.Solidity.Detectors.Typechecker
  ( detector
  ) where

import           CodeCollection
import           Control.Applicative ((<|>))
import           Control.Arrow ((&&&))
import           Control.Monad.Reader
import           Control.Monad.Trans.State
import           Data.Foldable (traverse_)
import           Data.Functor.Identity (runIdentity)
import           Data.List.NonEmpty (NonEmpty(..))
import qualified Data.List.NonEmpty as NE
import qualified Data.Map.Strict as M
import           Data.Maybe      (catMaybes, fromJust, fromMaybe)
import qualified Data.Set        as S
import           Data.Source
import           Data.String     (IsString, fromString)
import           Data.Text       (Text)
import qualified Data.Text       as T
import           Data.Traversable (for)
import           SolidVM.Solidity.Xabi
import           SolidVM.Solidity.Xabi.Statement
import           SolidVM.Solidity.Xabi.Type
import qualified SolidVM.Solidity.Xabi.Type as Xabi
import           SolidVM.Solidity.Xabi.VarDef

emptyAnnotation :: SourceAnnotation Text
emptyAnnotation = (SourceAnnotation (initialPosition "") (initialPosition "") "")

data R = R
  { codeCollection :: Annotated CodeCollectionF
  , contract :: Annotated ContractF
  , function :: Annotated FuncF
  }
type SSS = StateT (NonEmpty (Maybe Type', M.Map String (Annotated VarDefEntryF))) (Reader R)

data TypeF' a = Top { topName :: (S.Set String)
                    , topContext :: a
                    }
              | Bottom (NonEmpty a)
              | Static { staticType :: Type
                       , staticContext :: a
                       }
              | Product { productTypes :: [TypeF' a]
                        , productContext :: a
                        }
              | Sum { sumTypes :: NonEmpty (TypeF' a)
                    }
              | Function { functionArgType :: TypeF' a
                         , functionReturnType :: TypeF' a
                         , functionContext :: a
                         }
  deriving (Eq, Show, Functor)

type Type' = Annotated TypeF'

showType :: Type -> Text
showType (Int s b) = (if fromMaybe False s then "u" else "")
                  <> "int"
                  <> (maybe "" (T.pack . show) b)
showType (String _) = "string"
showType (Bytes _ b) = "bytes"
                    <> (maybe "" (T.pack . show) b)
showType Bool = "bool"
showType Address = "address"
showType Account = "account"
showType (Label s) = "label " <> T.pack s
showType (Struct _ n) = "struct " <> n
showType (Enum _ n _) = "enum " <> n
showType (Array t l) = T.concat
                     [ showType t
                     , "["
                     , maybe "" (T.pack . show) l
                     , "]"
                     ]
showType (Xabi.Contract n) = "contract " <> n
showType (Mapping _ k v) = "mapping (" <> showType k <> " => " <> showType v <> ")"

showType' :: Type' -> Text
showType' (Top _ _)  = "var"
showType' (Bottom _) = "bottom"
showType' (Static t _) = showType t
showType' (Product ts _) = T.concat
                         [ "("
                         , T.intercalate ", " $ showType' <$> ts
                         , ")"
                         ]
showType' (Sum ts) = T.concat
                       [ "("
                       , T.intercalate " | " $ showType' <$> NE.toList ts
                       , ")"
                       ]
showType' (Function a (Product [] _) _) =
  T.concat [ "function "
           , showType' a
           ]
showType' (Function a r _) =
  T.concat [ "function ("
           , showType' a
           , " returns "
           , showType' r
           ]

varDefsToType' :: Annotated VarDefEntryF -> Type' -> Type'
varDefsToType' BlankEntry t                   = t
varDefsToType' VarDefEntry{..} t | vardefType == Nothing = t
varDefsToType' VarDefEntry{..} (Top _ _)      = Static (fromJust vardefType) vardefContext
varDefsToType' VarDefEntry{..} t@(Static _ _) = Product [Static (fromJust vardefType) vardefContext, t] vardefContext
varDefsToType' VarDefEntry{..} t@(Sum _)      = Product [Static (fromJust vardefType) vardefContext, t] vardefContext
varDefsToType' VarDefEntry{..} (Product ts _) = Product (Static (fromJust vardefType) vardefContext : ts) vardefContext
varDefsToType' VarDefEntry{..} (Bottom es)    = Bottom es
varDefsToType' VarDefEntry{..} _              = bottom $ "Could not match variable definition with function type" <$ vardefContext

lookupEnum :: Text -> SSS [Text]
lookupEnum name = do
  c <- asks contract
  pure . fmap T.pack . maybe [] fst $ M.lookup (T.unpack name) (_enums c)

lookupStruct :: Text -> SSS [(Text, Type)]
lookupStruct name = do
  c <- asks contract
  let str = fromMaybe [] $ M.lookup (T.unpack name) (_structs c)
  pure $ f <$> str
  where f (t, ft, _) = (t, fieldTypeType ft)

lookupContractFunction :: Text -> Text -> SSS (Either Text ([Type], [Type]))
lookupContractFunction cName fName = do
  ~CodeCollection{..} <- asks codeCollection
  case M.lookup (T.unpack cName) _contracts of
    Nothing -> pure $ Left $ "Unknown contract: " <> cName
    Just c -> case M.lookup (T.unpack fName) (_functions c) of
      Nothing -> case M.lookup (T.unpack fName) (_constants c) of
        Nothing -> case M.lookup (T.unpack fName) (_storageDefs c) of
          Nothing -> pure . Left $ T.concat
            [ "Unknown contract function: "
            , cName
            , "."
            , fName
            ]
          Just VariableDecl{..} ->
            if varIsPublic
              then pure $ Right ([], [varType])
              else pure . Left $ T.concat
                [ "Contract variable "
                , cName
                , "."
                , fName
                , " is not public."
                ]
        Just ConstantDecl{..} ->
          if constIsPublic
            then pure $ Right ([], [constType])
            else pure . Left $ T.concat
              [ "Contract constant "
              , cName
              , "."
              , fName
              , " is not public."
              ]
      Just Func{..} -> case funcVisibility of
        Just v | v == Internal || v == Private -> pure $ Left $ T.concat
          [ "Function "
          , cName
          , "."
          , fName
          , " has visibility of "
          , T.pack $ show v
          , " so it cannot be called externally."
          ]
        _ -> let fArgs = indexedTypeType . snd <$> funcArgs
                 fRets = indexedTypeType . snd <$> funcVals
              in pure $ Right (fArgs, fRets)

productType' :: SourceAnnotation Text -> [Type'] -> Type'
productType' _ [Bottom es] = Bottom es
productType' _ [t] = t
productType' x ts = case reduceType' x ts of
  Bottom es -> Bottom es
  _ -> Product ts x

apply' :: Type' -> Type' -> Type' -> SSS Type'
apply' argTypes valTypes args = do
  p <- typecheck argTypes args
  pure $ case (p, valTypes) of
    (Bottom es, Bottom ess) -> Bottom (es <> ess)
    (Bottom es, _) -> Bottom es
    _ -> valTypes

apply :: Type' -> Type' -> SSS Type'
apply (Bottom es) (Bottom ess) = pure $ Bottom (es <> ess)
apply (Bottom es) _            = pure $ Bottom es
apply _ (Bottom ess)           = pure $ Bottom ess
apply (Function argTypes valTypes _) args = apply' argTypes valTypes args
apply (Sum types@(t :| _)) args =
  let isFunction (Function _ _ _) = True
      isFunction _ = False
   in pickType' (context' t) <$> traverse (flip apply args) (filter isFunction $ NE.toList types)
apply x _ = pure . bottom $ "trying to apply function to a non-function type" <$ context' x

bottom :: a -> TypeF' a
bottom a = Bottom $ a :| []

intType' :: SourceAnnotation Text -> Type'
intType' = Static (Int Nothing Nothing)

stringType' :: SourceAnnotation Text -> Type'
stringType' = Static (String Nothing)

-- bytesType' :: SourceAnnotation Text -> Type'
-- bytesType' = Static (Bytes Nothing Nothing)

boolType' :: SourceAnnotation Text -> Type'
boolType' = Static Bool

addressType' :: SourceAnnotation Text -> Type'
addressType' = Static Address

accountType' :: SourceAnnotation Text -> Type'
accountType' = Static Account

enumType' :: SourceAnnotation Text -> Type'
enumType' = Static (Enum Nothing "" Nothing)

-- structType' :: SourceAnnotation Text -> Type'
-- structType' = Static (Struct Nothing "")

contractType' :: SourceAnnotation Text -> Type'
contractType' = Static (Xabi.Contract "")

certType' :: SourceAnnotation Text -> Type'
certType' x = Static (Mapping Nothing (String Nothing) (String Nothing)) x

topType' :: SourceAnnotation Text -> Type'
topType' = Top S.empty

sumType' :: Type' -> Type' -> Type'
sumType' (Sum t1) (Sum t2) = Sum (t1 <> t2)
sumType' (Sum t1) t2 = Sum (t1 <> (t2 :| []))
sumType' t1 (Sum t2) = Sum ((t1 :| []) <> t2)
sumType' t1 t2       = Sum (t1 :| [t2])

pickType' :: SourceAnnotation Text -> [Type'] -> Type'
pickType' x [] = topType' x
pickType' _ [t] = t
pickType' x (t:ts) = case t of
  Bottom es -> case pickType' x ts of
    Bottom ess -> Bottom (es <> ess)
    t' -> t'
  _ -> t

reduceType' :: SourceAnnotation Text -> [Type'] -> Type'
reduceType' x [] = Product [] x
reduceType' _ [t] = t
reduceType' x (t:ts) = case (t, reduceType' x ts) of
  (Bottom es, Bottom ess) -> Bottom (es <> ess)
  (_, Bottom ess) -> Bottom ess
  _ -> t

context' :: TypeF' a -> a
context' Top{..}           = topContext
context' (Bottom (e :| _)) = e
context' Static{..}        = staticContext
context' Product{..}       = productContext
context' Function{..}      = functionContext
context' (Sum (a :| _))    = context' a


typecheck' :: Monad m => (SourceAnnotation Text -> String -> Type -> m Type') -> Type' -> Type' -> m Type'
typecheck' f r1 r2 = case (r1, r2) of
  (Bottom e1, Bottom e2) -> pure $ Bottom (e1 <> e2)
  (Bottom e, _) -> pure $ Bottom e
  (_, Bottom e) -> pure $ Bottom e
  (Top n1 _, Top n2 x) -> pure $ Top (n1 <> n2) x
  (Top names _, m@(Static t x)) -> reduceType' x . (m:) <$> traverse (\n -> f x n t) (S.toList names)
  (m@(Static t x), Top names _) -> m <$ reduceType' x . (m:) <$> traverse (\n -> f x n t) (S.toList names)
  (Top _ _, m) -> pure m
  (m, Top _ _) -> pure m
  (t1, Sum t2) -> pickType' (context' t1) <$> traverse (typecheck' f t1) (NE.toList t2)
  (Sum t1, t2) -> pickType' (context' t2) <$> traverse (flip (typecheck' f) t2) (NE.toList t1)
  (Static t1 _, Static t2 x) -> pure $ case typecheckStatic t1 t2 of
    Left msg -> bottom $ msg <$ x
    Right t  -> Static t x
  (Product t1 x, Product t2 _) -> typecheckProduct f x t1 t2
  (Product [a] _, b) -> typecheck' f a b
  (a, Product [b] _) -> typecheck' f a b
  (Function a1 v1 x, Function a2 v2 _) -> do
    a <- typecheck' f a1 a2
    v <- typecheck' f v1 v2
    pure $ case (a, v) of
      (Bottom es, Bottom ess) -> Bottom (es <> ess)
      (Bottom es, _) -> Bottom es
      (_, Bottom ess) -> Bottom ess
      _ -> Function a v x
  (a, b) -> pure . bottom $ (T.concat
              [ "could not match types "
              , showType' a
              , " and "
              , showType' b
              , "."
              ]) <$ context' a

typecheck :: Type' -> Type' -> SSS Type'
typecheck = typecheck' setVarType'

(~>) :: Type' -> SSS Type' -> SSS Type'
a ~> b = b >>= typecheck a
infixr 6 ~>

(<~>) :: SSS Type' -> SSS Type' -> SSS Type'
ma <~> mb = do
  a <- ma
  b <- mb
  typecheck a b
infixr 6 <~>

(!>) :: SSS Type' -> SSS Type' -> SSS Type'
ma !> mb = do
  a <- ma
  b <- mb
  pure $ const' b a
infixl 5 !>

typecheckProduct :: Monad m => (SourceAnnotation Text -> String -> Type -> m Type') -> SourceAnnotation Text -> [Type'] -> [Type'] -> m Type'
typecheckProduct f c t1 t2 = typecheckProduct' (Product t1 c) (Product t2 c) t1 t2
  where
    typecheckProduct' _ _ []     []     = pure $ Product [] c
    typecheckProduct' e a []     _      = pure . bottom $
      (T.concat
      [ "arities do not match. Expected "
      , showType' e
      , ", but got "
      , showType' a
      , "."
      ]) <$ c
    typecheckProduct' e a _      []     = pure . bottom $
      (T.concat
      [ "arities do not match. Expected "
      , showType' e
      , ", but got "
      , showType' a
      , "."
      ]) <$ c
    typecheckProduct' e a (x:xs) (y:ys) = do
      t <- typecheck' f x y
      ts <- typecheckProduct' e a xs ys
      pure $ case (t, ts) of
        (Bottom es, Bottom ess) -> Bottom (es <> ess)
        (Bottom es, _) -> Bottom es
        (_, Bottom es) -> Bottom es
        (t', Product ts' ctx) -> Product (t':ts') ctx
        (_, _) -> bottom $
          (T.concat
          [ "Could not resolve product type. Expected "
          , showType' e
          , ", but got "
          , showType' a
          , "."
          ]) <$ c

string' :: (Eq a, IsString a) => [a] -> a
string' [] = fromString ""
string' ("":as) = string' as
string' (a:_) = a

typecheckStatic :: Type -> Type -> Either Text Type
typecheckStatic (Int s1 b1) (Int s2 b2) =
  case (s1, s2) of
    (Just a, Just b) | a /= b -> Left "Mismatched signedness between integer values"
    _ -> case (b1, b2) of
           (Just a, Just b) | a /= b -> Left "Mismatched length between integer values"
           _ -> Right $ Int (s1 <|> s2) (b1 <|> b2)
typecheckStatic (String d1) (String d2) =
  case (d1, d2) of
    (Just a, Just b) | a /= b -> Left "Mismatched dynamicity between string values"
    _ -> Right $ String (d1 <|> d2)
typecheckStatic (Bytes d1 b1) (Bytes d2 b2) =
  case (d1, d2) of
    (Just a, Just b) | a /= b -> Left "Mismatched dynamicity between bytes values"
    _ -> case (b1, b2) of
           (Just a, Just b) | a /= b -> Left "Mismatched length between bytes values"
           _ -> Right $ Bytes (d1 <|> d2) (b1 <|> b2)
typecheckStatic Bool Bool = Right Bool
typecheckStatic Address Address = Right Account
typecheckStatic Address Account = Right Account
typecheckStatic Account Address = Right Account
typecheckStatic Account Account = Right Account
typecheckStatic (Label a) (Label b) =
  if a == b || a == "" || b == ""
    then Right (Label $ string' [a, b])
    else Left $ "Type mismatch: labels "
             <> T.pack a
             <> " and "
             <> T.pack b
             <> " do not match."
typecheckStatic (Label a) b@Struct{} =
  typecheckStatic (Struct Nothing (T.pack a)) b
typecheckStatic a@Struct{} (Label b) =
  typecheckStatic a (Struct Nothing (T.pack b))
typecheckStatic (Struct b1 t1) (Struct b2 t2) =
  case (b1, b2) of
    (Just a, Just b) | a /= b -> Left "Mismatched byte sizes between struct types"
    _ ->
      if t1 == t2 || t1 == "" || t2 == ""
        then Right $ Struct (b1 <|> b2) (string' [t1, t2])
        else Left $ "Type mismatch between struct values: "
                 <> t1
                 <> " and "
                 <> t2
                 <> " do not match."
typecheckStatic (Label a) b@Enum{} =
  typecheckStatic (Enum Nothing (T.pack a) Nothing) b
typecheckStatic a@Enum{} (Label b) =
  typecheckStatic a (Enum Nothing (T.pack b) Nothing)
typecheckStatic (Enum b1 t1 n1) (Enum b2 t2 n2) =
  case (b1, b2) of
    (Just a, Just b) | a /= b -> Left "Mismatched byte sizes between enum types"
    _ -> case (n1, n2) of
           (Just a, Just b) | a /= b -> Left "Mismatched names between enum types"
           _ -> if t1 == t2 || t1 == "" || t2 == ""
                  then Right $ Enum (b1 <|> b2) (string' [t1, t2]) (n1 <|> n2)
                  else Left $ "Type mismatch between enum values: "
                           <> t1
                           <> " and "
                           <> t2
                           <> " do not match."
typecheckStatic (Array t1 l1) (Array t2 l2) = do
  e <- typecheckStatic t1 t2
  case (l1, l2) of
    (Just a, Just b) | a /= b -> Left "Mismatched length between array values"
    _ -> Right $ Array e (l1 <|> l2)
typecheckStatic (Label a) b@Xabi.Contract{} =
  typecheckStatic (Xabi.Contract (T.pack a)) b
typecheckStatic a@Xabi.Contract{} (Label b) =
  typecheckStatic a (Xabi.Contract (T.pack b))
typecheckStatic (Xabi.Contract a) (Xabi.Contract b) =
  if a == b || a == "" || b == ""
    then Right (Xabi.Contract $ string' [a, b])
    else Left $ "Type mismatch: contracts "
             <> a
             <> " and "
             <> b
             <> " do not match."
typecheckStatic (Mapping d1 k1 v1) (Mapping d2 k2 v2) = do
  k <- typecheckStatic k1 k2
  v <- typecheckStatic v1 v2
  case (d1, d2) of
    (Just a, Just b) | a /= b -> Left "Mismatched dynamicity between mapping values"
    _ -> Right $ Mapping (d1 <|> d2) k v
typecheckStatic t1 t2 = Left $ "Type mismatch: "
                            <> showType t1
                            <> " and "
                            <> showType t2
                            <> " do not match."

typecheckIndex :: Type' -> Type' -> Type'
typecheckIndex (Bottom es) (Bottom ess) = Bottom (es <> ess)
typecheckIndex (Bottom es) _ = Bottom es
typecheckIndex _ (Bottom es) = Bottom es
typecheckIndex (Static (Array t _) x) (Static (Int _ _) y) = Static t (x <> y)
typecheckIndex (Static (Mapping _ k v) x) (Static t y) = case typecheckStatic k t of
  Left l -> bottom $ l <$ (x <> y)
  Right _ -> Static v (x <> y)
typecheckIndex x y = bottom $
  (T.concat
  [ "Mismatched index type: trying to lookup index of type "
  , showType' y
  , " from type "
  , showType' x
  , "."
  ]) <$ (context' x <> context' y)

typecheckMember :: Type' -> Text -> SSS Type'
typecheckMember (Bottom es) _ = pure $ Bottom es
typecheckMember (Static (Array _ _) x) "length" = pure $ Static (Int Nothing Nothing) x
typecheckMember (Static (Array t _) x) "push" = pure $ Function (Static t x) (Product [] x) x
typecheckMember (Static (Array _ _) x) n = pure . bottom $ ("Unknown member of Array: " <> n) <$ x
typecheckMember (Static (Label "Util") x) "bytes32ToString" = pure $ Function (Static (Bytes Nothing (Just 32)) x) (Static (String Nothing) x) x
typecheckMember (Static (Label "Util") x) "b32" = pure $ Function (Static (Bytes Nothing (Just 32)) x) (Static (Bytes Nothing (Just 32)) x) x
typecheckMember (Static (Label "msg") x) "sender" = pure $ Static Account x
typecheckMember (Static (Label "tx") x) "origin" = pure $ Static Account x
typecheckMember (Static (Label "tx") x) "username" = pure $ Static (String Nothing) x
typecheckMember (Static (Label "tx") x) "organization" = pure $ Static (String Nothing) x
typecheckMember (Static (Label "tx") x) "group" = pure $ Static (String Nothing) x
typecheckMember (Static (Label "block") x) "timestamp" = pure $ Static (Int Nothing Nothing) x
typecheckMember (Static (Label "block") x) "number" = pure $ Static (Int Nothing Nothing) x
typecheckMember (Static (Label "super") x) method = do
  ctract <- asks contract
  cc <- asks codeCollection
  let method' = T.unpack method
  case getParents ((fmap $ const ()) <$> cc) ((fmap $ const ()) <$> ctract) of
    Left _ -> pure . bottom $ "Contract has missing parents" <$ x
    Right parents' -> case filter (elem method' . M.keys .  _functions) parents' of
      [] -> pure . bottom $ "cannot use super without a parent contract" <$ x
      ps -> case M.lookup method' . _functions $ last ps of
        Nothing -> pure . bottom $ ("super does not have a function called " <> method) <$ x
        Just Func{..} ->
          let fArgs = flip Product x $ flip Static x . indexedTypeType . snd <$> funcArgs
              fRets = flip Product x $ flip Static x . indexedTypeType . snd <$> funcVals
           in pure $ Function fArgs fRets x
typecheckMember (Static e@(Enum _ enum mNames) x) n = do
  names <- case mNames of
    Just names -> pure names
    Nothing -> lookupEnum enum
  pure $ if n `elem` names
           then Static e x
           else bottom $ (T.concat
             [ "Missing enum element: "
             , n
             , " is not an element of "
             , enum
             ]) <$ x
typecheckMember (Static (Struct _ struct) x) n = do
  names <- M.fromList <$> lookupStruct struct
  pure $ case M.lookup n names of
    Just t -> Static t x
    Nothing -> bottom $ (T.concat
      [ "Missing struct element: "
      , n
      , " is not a field of "
      , struct
      ]) <$ x
typecheckMember (Static (Xabi.Contract c) x) n = do
  types <- lookupContractFunction c n
  case types of
    Left t -> pure . bottom $ t <$ x
    Right (args, rets) -> pure $ Function (flip Product x $ flip Static x <$> args)
                                          (flip Product x $ flip Static x <$> rets)
                                          x
typecheckMember (Static (Label c') x) n = do
  let c = T.pack c'
  e <- typecheckMember (Static (Enum Nothing c Nothing) x) n
  case e of
    Bottom _ -> do
      s <- typecheckMember (Static (Struct Nothing c) x) n
      case s of
        Bottom _ -> do
          f <- typecheckMember (Static (Xabi.Contract c) x) n
          case f of
            Bottom _ -> pure . bottom $ (T.concat
              [ "Missing label: "
              , c
              , " is not a known enum, struct, or contract."
              ]) <$ x
            t -> pure t
        t -> pure t
    t -> pure t
typecheckMember x n = pure . bottom $ ("Unknown member: " <> showType' x <> "." <> n) <$ context' x

getConstructorType' :: MonadReader R m => SourceAnnotation Text -> Text -> m Type'
getConstructorType' x l = do
  ~CodeCollection{..} <- asks codeCollection
  case M.lookup (T.unpack l) _contracts of
    Nothing -> pure . bottom $ ("Unknown contract: " <> l) <$ x
    Just c -> case _constructor c of
      Nothing -> pure $ Function (Product [] x) (Static (Xabi.Contract l) x) x
      Just Func{..} ->
        let fArgs = flip Product x $ flip Static x . indexedTypeType . snd <$> funcArgs
         in pure $ Function fArgs (Static (Xabi.Contract l) x) x

getTypeErrors :: Type' -> [SourceAnnotation Text]
getTypeErrors (Bottom ts) = NE.toList ts
getTypeErrors _           = []

const' :: Type' -> Type' -> Type'
const' _ (Bottom e) = Bottom e
const' t _ = t

-- type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]
detector :: CompilerDetector
detector cc =
  let cc'@CodeCollection{..} = (\sa -> sa{_sourceAnnotationAnnotation = ""}) <$> cc
   in fromMaybe []
      . fmap (\(a :| as) -> getTypeErrors $ reduceType' emptyAnnotation (a:as))
      . NE.nonEmpty
      $ contractHelper cc'
      <$> M.elems _contracts

contractHelper :: Annotated CodeCollectionF
               -> Annotated ContractF
               -> Type'
contractHelper cc c = 
  let constr = maybe M.empty (M.singleton "constructor") $ _constructor c
      funcsAndConstr = constr <> _functions c
   in reduceType' (_contractContext c) $ functionHelper cc c <$> M.elems funcsAndConstr

functionHelper :: Annotated CodeCollectionF
               -> Annotated ContractF
               -> Annotated FuncF
               -> Type'
functionHelper cc c f@Func{..} = case funcContents of
  Nothing -> Function (Product [] funcContext) (Product [] funcContext) funcContext
  Just stmts ->
    let r = R cc c f
        swap = uncurry $ flip (,)
        args = (\(it,n) -> ( n
                           , VarDefEntry (Just $ indexedTypeType it) Nothing n funcContext
                           ))
           <$> (map (fmap T.unpack) . catMaybes $ sequence . swap <$> funcArgs)
        vals = (\(it,n) -> ( n
                           , VarDefEntry (Just $ indexedTypeType it) Nothing n funcContext
                           ))
           <$> (map (fmap T.unpack) . catMaybes $ sequence . swap <$> funcVals)
        argVals = M.fromList $ args ++ vals
     in runReader (statementsHelper argVals stmts) r

statementsHelper :: (M.Map String (Annotated VarDefEntryF))
                 -> [Annotated StatementF]
                 -> Reader R Type'
statementsHelper args ss = do
  f <- asks function
  let x = funcContext f
  ~(ts', s) <- flip runStateT ((Nothing, args) :| []) $ do
    cCalls <- for (M.assocs $ funcConstructorCalls f) $ \(cName, exprs) -> do
      let cName' = T.pack cName
          constructorArgs = getConstructorType' x cName'
          givenArgs = flip Product x <$> traverse tcExpr exprs
          givenFunc = (\t-> Function t (Static (Xabi.Contract cName') x) x) <$> givenArgs
      constructorArgs <~> givenFunc
    stmts' <- traverse statementHelper ss
    pure $ concat [stmts', cCalls]
  let ret = case fst $ NE.head s of
              Nothing -> Product [] x
              Just (Sum rs) -> runIdentity $
                foldr
                  (\a mb -> mb >>= \b -> case (a,b) of
                    (Bottom es, Bottom ess) -> pure $ Bottom (es <> ess)
                    (Bottom es, _) -> pure $ Bottom es
                    (_, Bottom ess) -> pure $ Bottom ess
                    _ -> do
                      t' <- typecheck' (\c _ _ -> pure $ topType' c) a b
                      case t' of
                        Bottom _ -> pure . bottom $ "not all paths return a value." <$ x
                        _ -> pure t'
                  )
                  (pure $ topType' x)
                  (NE.toList rs)
              Just r -> r
  pure $ reduceType' x $ ret:ts'

statementsHelper' :: SourceAnnotation Text -> [Annotated StatementF] -> SSS Type'
statementsHelper' x stmts = do
  modify $ NE.cons (Nothing, M.empty)
  anns <- reduceType' x <$> traverse statementHelper stmts
  modify $ \case
    _ :| [] -> error "statementsHelper': Stack underflow"
    (r,_) :| ((s, l):rest) -> case (r, s) of
      (Nothing, Nothing) -> (Just (Sum (Product [] x :| [])), l) :| rest
      (Nothing, Just (Sum ss)) -> (Just (Sum (NE.cons (Product [] x) ss)), l) :| rest
      (Just (Bottom es), Just (Bottom ess)) -> (Just (Bottom (es <> ess)), l) :| rest
      (Just (Bottom es), Nothing) -> (Just (Bottom es), l) :| rest
      (Nothing, Just (Bottom ess)) -> (Just (Bottom ess), l) :| rest
      (Just (Sum rs), Nothing) -> (Just (Sum rs), l) :| rest
      (Just rs, Nothing) -> (Just (Sum (rs :| [])), l) :| rest
      (Just (Sum rs), Just (Sum ss)) -> (Just (Sum (rs <> ss)), l) :| rest
      (Just rs, Just (Sum ss)) -> (Just (Sum (NE.cons rs ss)), l) :| rest
      (_, Just ss) -> (Just ss, l) :| rest
  pure anns

intArgs :: SourceAnnotation Text -> Type'
intArgs x = Sum $ enumType' x :|
                [ intType' x
                , stringType' x
                ]

stringArgs :: SourceAnnotation Text -> Type'
stringArgs x = Sum $ stringType' x :|
                   [ addressType' x
                   , accountType' x
                   , intType' x
                   , boolType' x
                   ]

addressArgs :: SourceAnnotation Text -> Type'
addressArgs x = Sum $ stringType' x :|
                    [ addressType' x
                    , accountType' x
                    , intType' x
                    , contractType' x
                    ]

accountArgs :: SourceAnnotation Text -> Type'
accountArgs x = Sum $ stringType' x :|
                    [ addressType' x
                    , accountType' x
                    , intType' x
                    , contractType' x
                    , Product [intType' x, intType' x] x
                    , Product [intType' x, stringType' x] x
                    , Product [addressType' x, intType' x] x
                    , Product [accountType' x, intType' x] x
                    , Product [addressType' x, stringType' x] x
                    , Product [accountType' x, stringType' x] x
                    , Product [addressType' x, stringType' x, intType' x] x
                    , Product [accountType' x, stringType' x, intType' x] x
                    ]

boolArgs :: SourceAnnotation Text -> Type'
boolArgs x = Sum $ stringType' x :|
                 [ boolType' x
                 ]

byteArgs :: SourceAnnotation Text -> Type'
byteArgs x = intType' x

keccak256Args :: SourceAnnotation Text -> Type'
keccak256Args x = stringType' x

requireArgs :: SourceAnnotation Text -> Type'
requireArgs x = Sum $ boolType' x :|
                    [ Product [boolType' x, topType' x] x
                    ]

assertArgs :: SourceAnnotation Text -> Type'
assertArgs x = boolType' x

registerCertArgs :: SourceAnnotation Text -> Type'
registerCertArgs x = Product [accountType' x, stringType' x] x

getUserCertArgs :: SourceAnnotation Text -> Type'
getUserCertArgs x = accountType' x

parseCertArgs :: SourceAnnotation Text -> Type'
parseCertArgs x = stringType' x

getVarType' :: String -> SourceAnnotation Text -> SSS Type'
getVarType' "this" ctx = pure $ Static Account ctx
getVarType' "uint" ctx = pure $ Function (intArgs ctx) (Static (Int (Just False) Nothing) ctx) ctx
getVarType' "int" ctx =  pure $ Function (intArgs ctx) (Static (Int (Just True) Nothing) ctx) ctx
getVarType' "address" ctx =  pure $ Function (addressArgs ctx) (Static Account ctx) ctx
getVarType' "account" ctx =  pure $ Function (accountArgs ctx) (Static Account ctx) ctx
getVarType' "string" ctx =  pure $ Function (stringArgs ctx) (stringType' ctx) ctx
getVarType' "bool" ctx =  pure $ Function (boolArgs ctx) (boolType' ctx) ctx
getVarType' "byte" ctx =  pure $ Function (byteArgs ctx) (intType' ctx) ctx
getVarType' "push" ctx =  pure $ Function (topType' ctx) (Product [] ctx) ctx
getVarType' "identity" ctx =  pure $ Function (topType' ctx) (topType' ctx) ctx
getVarType' "keccak256" ctx =  pure $ Function (keccak256Args ctx) (stringType' ctx) ctx
getVarType' "require" ctx =  pure $ Function (requireArgs ctx) (Product [] ctx) ctx
getVarType' "assert" ctx =  pure $ Function (assertArgs ctx) (Product [] ctx) ctx
getVarType' "registerCert" ctx =  pure $ Function (registerCertArgs ctx) (Product [] ctx) ctx
getVarType' "getUserCert" ctx =  pure $ Function (getUserCertArgs ctx) (certType' ctx) ctx
getVarType' "parseCert" ctx =  pure $ Function (parseCertArgs ctx) (certType' ctx) ctx
getVarType' "Util" ctx = pure $ Static (Label "Util") ctx
getVarType' "msg" ctx = pure $ Static (Label "msg") ctx
getVarType' "tx" ctx = pure $ Static (Label "tx") ctx
getVarType' "block" ctx = pure $ Static (Label "block") ctx
getVarType' "super" ctx = pure $ Static (Label "super") ctx

getVarType' name ctx = do
  mVar <- foldr (lookupVar . snd) Nothing <$> get
  case mVar of
    Just BlankEntry -> error "getVarType' BlankEntry: I don't think this can happen"
    Just VarDefEntry{..} -> case vardefType of
      Just t -> pure $ Static t ctx
      Nothing -> pure $ Top (S.singleton name) ctx
    Nothing -> do
      c <- asks contract
      let mVarDecl = ((varType &&& const ctx) <$> M.lookup name (_storageDefs c))
                 <|> ((constType &&& const ctx) <$> M.lookup name (_constants c))
                 <|> (const (Enum Nothing (T.pack name) Nothing, ctx) <$> M.lookup name (_enums c))
                 <|> (const (Struct Nothing (T.pack name), ctx) <$> M.lookup name (_structs c))
      case mVarDecl of
        Just (e@(Enum{}), ctx') -> pure . Sum $
          (Static e ctx') :|
          [ Function (Static e ctx') (Static e ctx') ctx'
          , Function (intType' ctx') (Static e ctx') ctx'
          ]
        Just (s@(Struct _ struct), ctx') -> do
          fields <- fmap snd <$> lookupStruct struct
          let fArgs = flip Product ctx $ flip Static ctx <$> fields
          pure . Sum $
            (Static s ctx') :|
            [ Function fArgs (Static s ctx') ctx'
            ]
        Just (t, ctx') -> pure $ Static t ctx'
        Nothing -> case M.lookup name $ _functions c of
          Just Func{..} ->
            let fArgs = flip Product ctx $ flip Static ctx . indexedTypeType . snd <$> funcArgs
                fRets = flip Product ctx $ flip Static ctx . indexedTypeType . snd <$> funcVals
             in pure $ Function fArgs fRets ctx
          Nothing -> do
            cc <- asks codeCollection
            pure $ case M.lookup name $ _contracts cc of
              Just _->
                let ctrct = Static (Xabi.Contract $ T.pack name) ctx
                    lbl = Static (Label name) ctx
                 in Function (Sum (Static Account ctx :| [ctrct, lbl]))
                             ctrct
                             ctx
              Nothing -> bottom $ ("Unknown variable: " <> T.pack name) <$ ctx
            
  where lookupVar m Nothing = M.lookup name m
        lookupVar _ t       = t

setVarType' :: SourceAnnotation Text -> String -> Type -> SSS Type'
setVarType' ctx name ty = state setType'
  where setType' (m:|ms) = case M.lookup name $ snd m of
          Nothing -> case ms of
            [] -> (bottom $ ("Unknown variable: " <> T.pack name) <$ ctx, m:|[])
            (r:est) -> NE.cons m <$> setType' (r:|est)
          Just BlankEntry -> (bottom $ ("Variable listed as BlankEntry: " <> T.pack name) <$ ctx, m:|ms)
          Just t@VarDefEntry{..} -> case vardefType of
            Nothing ->
              let t' = t{vardefType = Just ty}
               in (Static ty ctx, (M.insert name t' <$> m) :| ms)
            Just ty' -> case typecheckStatic ty ty' of
              Right ty'' -> (Static ty'' ctx, m:|ms)
              Left e -> (bottom $ ("Variable " <> T.pack name <> " being updated with wrong type: " <> e) <$ ctx, m:|ms)

pushLocalVariable :: Annotated VarDefEntryF -> SSS ()
pushLocalVariable BlankEntry = pure ()
pushLocalVariable v@VarDefEntry{..} = modify $ \case
  (r,x) :| xs -> (r, M.insert vardefName v x) :| xs

pushLocalVariables :: [Annotated VarDefEntryF] -> SSS ()
pushLocalVariables = traverse_ pushLocalVariable

statementHelper :: Annotated StatementF -> SSS Type'
statementHelper (IfStatement cond thens mElse x) = do
  cs <- tcExpr cond
  ts <- statementsHelper' x thens
  es <- statementsHelper' x $ fromMaybe [] mElse
  pure $ reduceType' x [cs, ts, es]
statementHelper (WhileStatement cond body x) = do
  cs <- tcExpr cond
  bs <- statementsHelper' x body
  pure $ reduceType' x [cs, bs]
statementHelper (ForStatement mInit mCond mPost body x) = do
  is <- maybe (pure $ topType' x) (simpleStatementHelper x) mInit
  cs <- maybe (pure $ topType' x) tcExpr mCond
  ps <- maybe (pure $ topType' x) tcExpr mPost
  bs <- statementsHelper' x body
  pure $ reduceType' x [is, cs, ps, bs]
statementHelper (Block x) = pure $ topType' x
statementHelper (DoWhileStatement body cond x) = do
  cs <- tcExpr cond
  bs <- statementsHelper' x body
  pure $ reduceType' x [bs, cs]
statementHelper (Continue x) = pure $ topType' x
statementHelper (Break x) = pure $ topType' x
statementHelper (Return mExpr x) = do
  f <- asks function
  let fRets = flip Product x $ flip Static x . indexedTypeType . snd <$> funcVals f
  t' <- fRets ~> maybe (pure $ Product [] x) tcExpr mExpr
  modify $ \((ret, locals) :| rest) -> case ret of
    Nothing -> (Just t', locals) :| rest
    Just (Sum _) -> (Just t', locals) :| rest
    _ -> (ret, locals) :| rest
  pure t'
statementHelper (Throw x) = pure $ topType' x
statementHelper (EmitStatement _ vals x) =
  reduceType' x <$> traverse (tcExpr . snd) vals
statementHelper (AssemblyStatement _ x) = pure $ topType' x
statementHelper (SimpleStatement stmt x) = simpleStatementHelper x stmt

simpleStatementHelper :: SourceAnnotation Text -> Annotated SimpleStatementF -> SSS Type'
simpleStatementHelper x (VariableDefinition vdefs mExpr) = do
  pushLocalVariables vdefs
  let ts' = foldr varDefsToType' (topType' x) vdefs
  ts' ~> maybe (pure $ topType' x) tcExpr mExpr
simpleStatementHelper _ (ExpressionStatement expr) =
  tcExpr expr

tcExpr :: Annotated ExpressionF -> SSS Type'
tcExpr (Binary x "+" a b) =
  sumType' (intType' x) (stringType' x)  ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "-" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "*" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "/" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "%" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "|" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "&" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "^" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "**" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "<<" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x ">>" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "+=" a b) =
  sumType' (intType' x) (stringType' x)  ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "-=" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "*=" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "/=" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "%=" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "|=" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "&=" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "^=" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "||" a b) =
  boolType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "&&" a b) =
  boolType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "!=" a b) =
  tcExpr a <~> tcExpr b !> pure (boolType' x)
tcExpr (Binary x "==" a b) =
  tcExpr a <~> tcExpr b !> pure (boolType' x)
tcExpr (Binary x "<" a b) =
  intType' x ~> tcExpr a <~> tcExpr b !> pure (boolType' x)
tcExpr (Binary x ">" a b) =
  intType' x ~> tcExpr a <~> tcExpr b !> pure (boolType' x)
tcExpr (Binary x ">=" a b) =
  intType' x ~> tcExpr a <~> tcExpr b !> pure (boolType' x)
tcExpr (Binary x "<=" a b) =
  intType' x ~> tcExpr a <~> tcExpr b !> pure (boolType' x)
tcExpr (Binary _ _ a b) =
  tcExpr a <~> tcExpr b
tcExpr (PlusPlus x a) = 
  intType' x ~> tcExpr a
tcExpr (MinusMinus x a) = do
  intType' x ~> tcExpr a
tcExpr (NewExpression x b@Bytes{}) = pure $ Static b x
tcExpr (NewExpression x a@Array{}) = pure $ Static a x
tcExpr (NewExpression x (Label l)) = getConstructorType' x $ T.pack l
tcExpr (NewExpression x (Xabi.Contract l)) = getConstructorType' x l
tcExpr (NewExpression x t) = pure . bottom $ ("Cannot use keyword 'new' in conjuction with type " <> showType t) <$ x
tcExpr (IndexAccess _ a (Just b)) =
  typecheckIndex <$> tcExpr a <*> tcExpr b
tcExpr (IndexAccess _ a Nothing) = tcExpr a
tcExpr (MemberAccess _ a fieldName) = do
  t <- tcExpr a
  typecheckMember t (T.pack fieldName)
tcExpr (FunctionCall x expr args) = do
  e <- tcExpr expr
  a <- case args of
         OrderedArgs es -> productType' x <$> traverse tcExpr es
         NamedArgs es -> productType' x <$> traverse (tcExpr . snd) es
  apply e a
tcExpr (Unitary x "++" a) = intType' x ~> tcExpr a
tcExpr (Unitary x "--" a) = intType' x ~> tcExpr a
tcExpr (Unitary x "!" a) = boolType' x ~> tcExpr a
tcExpr (Unitary x "delete" a) = tcExpr a !> pure (Product [] x)
tcExpr (Unitary _ _ a) = tcExpr a
tcExpr (Ternary x a b c) =
   boolType' x ~> tcExpr a !> tcExpr b <~> tcExpr c
tcExpr (BoolLiteral x _) = pure $ boolType' x
tcExpr (NumberLiteral x _ _) = pure $ intType' x
tcExpr (StringLiteral x _) = pure $ stringType' x
tcExpr (TupleExpression x es) =
  productType' x <$> traverse (maybe (pure $ topType' x) tcExpr) es
tcExpr (ArrayExpression x es) = do
  t' <- foldr (<~>) (pure $ topType' x) $ tcExpr <$> es
  pure $ case t' of
    (Static t _) ->Static (Array t Nothing) x
    _ -> t'
tcExpr (Variable x name) = getVarType' name x
