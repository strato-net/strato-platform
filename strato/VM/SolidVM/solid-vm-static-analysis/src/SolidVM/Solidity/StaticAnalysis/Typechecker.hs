{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module SolidVM.Solidity.StaticAnalysis.Typechecker
  ( detector,
  )
where

import Control.Applicative ((<|>))
import Control.Arrow ((&&&))
import Control.Lens hiding (enum)
import Control.Monad (forM, msum)
import Control.Monad.Reader
import Control.Monad.Trans.State
import Data.Bool (bool)
import Data.Foldable (traverse_)
import Data.List.NonEmpty (NonEmpty (..))
import qualified Data.List.NonEmpty as NE
import qualified Data.Map.Strict as M
import Data.Maybe (catMaybes, fromJust, fromMaybe, isJust)
import qualified Data.Set as S
import Data.Source
import Data.String (IsString, fromString)
import Data.Text (Text)
import qualified Data.Text as T
import SolidVM.Model.CodeCollection hiding (modifierContext)
import qualified SolidVM.Model.CodeCollection.Contract as Con
import SolidVM.Model.SolidString
import SolidVM.Model.Type (Type)
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Solidity.StaticAnalysis.Types
import Text.Read (readMaybe)
import Blockchain.VM.SolidException

emptyAnnotation :: SourceAnnotation Text
emptyAnnotation = (SourceAnnotation (initialPosition "") (initialPosition "") "")

data R = R
  { codeCollection :: Annotated CodeCollectionF,
    contract :: Annotated ContractF,
    function :: Maybe (Annotated FuncF),
    functName :: Maybe String,
    modifier :: Maybe (Annotated ModifierF),
    immutableValNames :: [(String, Bool)]
  }

type SSS = StateT (NonEmpty (Maybe Type', M.Map SolidString (Annotated VarDefEntryF))) (Reader R)

data TypeF' a
  = Top
      { topName :: (S.Set SolidString),
        topContext :: a
      }
  | Bottom (NonEmpty a)
  | Static
      { staticType :: Type,
        staticContext :: a
      }
  | Product
      { productTypes :: [TypeF' a],
        productContext :: a
      }
  | MultiVariate
      { multiVariateType :: (TypeF' a),
        multiVariateContext :: a
      }
  | Sum
      { sumTypes :: NonEmpty (TypeF' a)
      }
  | Function
      { functionArgType :: TypeF' a,
        functionReturnType :: TypeF' a,
        functionContext :: a,
        functionOverloads :: [TypeF' a],
        functionArgNames :: [Maybe SolidString],
        functionArrayGetter :: Bool
      }
  | Modifier
      { modifierArgs :: M.Map Text IndexedType,
        modifierSelector :: Text,
        modifierContents :: Maybe [StatementF a],
        modifierContext :: a
      }
  deriving (Eq, Show, Functor)

type Type' = Annotated TypeF'

showType :: Type -> Text
showType (SVMType.Int s b) =
  (if fromMaybe False s then "" else "u")
    <> "int"
    <> (maybe "" (T.pack . show) b)
showType (SVMType.String _) = "string"
showType (SVMType.Bytes _ b) =
  "bytes"
    <> (maybe "" (T.pack . show) b)
showType SVMType.Decimal = "decimal"
showType SVMType.Bool = "bool"
showType (SVMType.Address _) = "address"
showType (SVMType.Account _) = "account"
showType (SVMType.UnknownLabel s _) = "label " <> labelToText s
showType (SVMType.Struct _ n) = "struct " <> labelToText n
showType (SVMType.UserDefined _ a) = showType a
showType (SVMType.Enum _ n _) = "enum " <> labelToText n
showType (SVMType.Error _ n) = "error " <> labelToText n
showType (SVMType.Array t l) =
  T.concat
    [ showType t,
      "[",
      maybe "" (T.pack . show) l,
      "]"
    ]
showType (SVMType.Contract n) = "contract " <> labelToText n
showType (SVMType.Mapping _ k v) = "mapping (" <> showType k <> " => " <> showType v <> ")"
showType SVMType.Variadic = "variadic"

showType' :: Type' -> Text
showType' (Top _ _) = "var"
showType' (Bottom _) = "bottom"
showType' (Static t _) = showType t
showType' (Product ts _) =
  T.concat
    [ "(",
      T.intercalate ", " $ showType' <$> ts,
      ")"
    ]
showType' (Sum ts) =
  T.concat
    [ "(",
      T.intercalate " | " $ showType' <$> NE.toList ts,
      ")"
    ]
showType' (Function a (Product [] _) _ _ _ _) =
  T.concat
    [ "function ",
      showType' a
    ]
showType' (Function a r _ _ _ _) =
  T.concat
    [ "function (",
      showType' a,
      " returns ",
      showType' r
    ]
showType' (MultiVariate a _) =
  T.concat
    [ "(",
      showType' a,
      ")"
    ]
showType' (SolidVM.Solidity.StaticAnalysis.Typechecker.Modifier _ _ _ _) =
  T.empty


varDefsToType' :: Annotated VarDefEntryF -> Type' -> Type'
varDefsToType' BlankEntry t = Product [topType' (context' t), t] (context' t)
varDefsToType' VarDefEntry {..} t | vardefType == Nothing = t
varDefsToType' VarDefEntry {..} (Top _ _) = Static (fromJust vardefType) vardefContext
varDefsToType' VarDefEntry {..} t@(Static _ _) = Product [Static (fromJust vardefType) vardefContext, t] vardefContext
varDefsToType' VarDefEntry {..} t@(Sum _) = Product [Static (fromJust vardefType) vardefContext, t] vardefContext
varDefsToType' VarDefEntry {..} (Product ts _) = Product (Static (fromJust vardefType) vardefContext : ts) vardefContext
varDefsToType' VarDefEntry {} (Bottom es) = Bottom es
varDefsToType' VarDefEntry {..} _ = bottom $ "Could not match variable definition with function type" <$ vardefContext

lookupEnum :: SolidString -> SSS [SolidString]
lookupEnum name = do
  cc <- asks codeCollection
  c <- asks contract
  pure . maybe [] fst $ msum [(M.lookup name (_enums c)), (M.lookup name (_flEnums cc))]

lookupStruct :: SolidString -> SSS [(SolidString, Type)]
lookupStruct name = do
  cc <- asks codeCollection
  c <- asks contract
  let str = fromMaybe [] $ msum [(M.lookup name (_structs c)), (M.lookup name (_flStructs cc))]
  pure $ f <$> str
  where
    f (t, ft, _) = (t, fieldTypeType ft)

lookupError :: SolidString -> SSS [(SolidString, Type)]
lookupError name = do
  cc <- asks codeCollection
  c <- asks contract
  let err = fromMaybe [] $ msum [(M.lookup name (_errors c)), (M.lookup name (_flErrors cc))]
  pure $ f <$> err
  where
    f (t, ft, _) = (t, indexedTypeType ft)

functionType :: CodeCollectionF a -> a -> SolidString -> FuncF a -> TypeF' a
functionType cc x name f =
  let fArgs = flip Product x $ flip Static x . indexedTypeType . snd <$> _funcArgs f
      fRets = flip Product x $ flip Static x . indexedTypeType . snd <$> _funcVals f
      fArgNames = fst <$> _funcArgs f
      overloads = case M.lookup name $ _flFuncs cc of
        Just freeFunc ->
          (functionType cc x name <$> _funcOverload f)
            ++ [functionType cc x name freeFunc]
            ++ (functionType cc x name <$> _funcOverload freeFunc)
        Nothing -> functionType cc x name <$> _funcOverload f
   in Function fArgs fRets x overloads fArgNames False

modifierType :: a -> ModifierF a -> TypeF' a
modifierType x f =
  let fArgs = flip Product x $ flip Static x . indexedTypeType . snd <$> _modifierArgs f
      fRets = Product [] x
      fArgNames = Just . textToLabel . fst <$> _modifierArgs f
   in Function fArgs fRets x [] fArgNames False

eventType :: a -> EventF a -> TypeF' a
eventType x f =
  let fArgs = flip Product x $ flip Static x . indexedTypeType . _eventLogType <$> _eventLogs f
      fRets = Product [] x
      fArgNames = Just . textToLabel . _eventLogName <$> _eventLogs f
   in Function fArgs fRets x [] fArgNames False

filterFuncs :: Annotated CodeCollectionF -> SourceAnnotation Text -> SolidString -> Annotated FuncF -> [Visibility] -> Type'
filterFuncs cc x name f visibilities = case f ^. funcVisibility of
  Just v
    | usesStrictModifiers cc && v `elem` visibilities ->
      bottom $ "cannot access function " <> labelToText name <> " because it is marked as " <> tShowVisibility v <$ x
  _ -> functionType cc x name $ ("" <$) <$> f

lookupContractFunction :: SourceAnnotation Text -> SolidString -> SolidString -> SSS Type'
lookupContractFunction x cName fName = do
  cc@CodeCollection {..} <- asks codeCollection
  pure $ case M.lookup cName _contracts of
    Nothing -> bottom $ ("Unknown contract: " <> labelToText cName) <$ x
    Just c -> case M.lookup fName (_functions c) of
      Nothing -> case M.lookup fName (_constants c) of
        Nothing -> case M.lookup fName (_storageDefs c) of
          Nothing ->
            bottom $
              ( T.concat
                  [ "Unknown contract function: ",
                    labelToText cName,
                    ".",
                    labelToText fName
                  ]
              )
                <$ x
          Just VariableDecl {..} ->
            if _varIsPublic
              then do 
                nestedType' x _varType
              else
                bottom $
                  ( T.concat
                      [ "Contract variable ",
                        labelToText cName,
                        ".",
                        labelToText fName,
                        " is not public."
                      ]
                  )
                    <$ x
        Just ConstantDecl {..} -> Static _constType x
      Just f -> filterFuncs cc x fName f [Internal, Private]
      
  where 
    nestedType' :: SourceAnnotation Text -> SVMType.Type -> Type'
    nestedType' y (SVMType.Array t _) = let f = nestedType' y t
                                          in case f of
                                              Function (Product args _) ret _ _ _ _ -> Function (Product ((intType' y):args) y) ret y [] [] True
                                              _ -> bottom $ "A maximum one layer nesting of arrays is supported" <$ y
    nestedType' y (SVMType.Mapping _ k v) = let f = nestedType' y v
                                              in case f of
                                                  Function (Product args _) ret _ _ _ _ -> Function (Product ((Static k y):args) y) ret y [] [] False
                                                  _ -> bottom $ "A maximum one layer nesting of mappings is supported" <$ y
    nestedType' y t = Function (Product [] y) (Static t y) y [] [] False

productType' :: SourceAnnotation Text -> [Type'] -> Type'
productType' _ [Bottom es] = Bottom es
productType' _ [t] = t
productType' x ts = case reduceType' x ts of
  Bottom es -> Bottom es
  _ -> Product ts x

apply' :: Type' -> Type' -> [Type'] -> Type' -> Maybe [SolidString] -> [Maybe SolidString] -> Bool -> SSS Type'
apply' funcArgTypes funcValTypes overloads args argNames funcArgNames functionArrayGetter = do
  let reorderedArgs = case argNames of
        Nothing -> args
        Just a ->
          let zipped = M.fromList $ zip a $ productTypes args
              newOrder =
                map
                  ( \case
                      Nothing -> error "Argument name does not exist"
                      Just x -> case M.lookup x zipped of
                        Nothing -> error "Argument name does not exist" x
                        Just y -> y
                  )
                  funcArgNames
           in flip Product (productContext args) newOrder
  p <- case argNames of
    Nothing -> typecheck funcArgTypes args
    _ -> typecheck funcArgTypes reorderedArgs
  let lengthOfArgs = case args of
                       (Product [] _) -> 0
                       (Product a _) -> length a
                       _ -> 0
      arrayLayer = case funcValTypes of
                     (Static a@(SVMType.Array _ _) x) -> flip Static x $ loop lengthOfArgs a
                     _ -> funcValTypes
      funcValTypes' = case (functionArrayGetter, funcArgTypes, funcValTypes) of
                        (True, (Product ([(Static (SVMType.Int _ _) _), (Static (SVMType.Variadic) _)]) _), (Static (SVMType.Array _ _) _)) -> arrayLayer  
                        _ -> funcValTypes
  case (p, funcValTypes') of
    (Bottom es, Bottom ess) -> pure $ Bottom (es <> ess)
    (Bottom es, _) -> case overloads of
      [] -> pure $ Bottom es
      (x : xs) -> apply' (functionArgType x) (functionReturnType x) xs args argNames (functionArgNames x) functionArrayGetter
    _ -> pure $ funcValTypes'
  where
    loop count (SVMType.Array t _) = 
      if count == 0
        then t
        else loop (count - 1) t
    loop 0 b = b
    loop _ _ = error "trying to access an index outside of range"

apply :: Type' -> Type' -> Maybe [SolidString] -> SSS Type'
apply (Bottom es) (Bottom ess) _ = pure $ Bottom (es <> ess)
apply (Bottom es) _ _ = pure $ Bottom es
apply _ (Bottom ess) _ = pure $ Bottom ess
apply (Function funcArgTypes funcValTypes _ overloads funcArgNames functionArrayGetter) args argNames = apply' funcArgTypes funcValTypes overloads args argNames funcArgNames functionArrayGetter
apply (Top ts x) _ _ = pure $ Top ts x
apply (Sum types@(t :| _)) args argList =
  let isFunction (Function _ _ _ _ _ _) = True
      isFunction (Top _ _) = True
      isFunction _ = False
   in pickType' (context' t) <$> traverse (\x -> apply x args argList) (filter isFunction $ NE.toList types)
apply x _ _ = pure . bottom $ "trying to apply function to a non-function type" <$ context' x

bottom :: a -> TypeF' a
bottom a = Bottom $ a :| []

unlessBottom :: TypeF' a -> (TypeF' a -> TypeF' a) -> TypeF' a
unlessBottom (Bottom e) _ = Bottom e
unlessBottom t' f = f t'

intType' :: SourceAnnotation Text -> Type'
intType' = Static (SVMType.Int Nothing Nothing)

decimalType' :: SourceAnnotation Text -> Type'
decimalType' = Static SVMType.Decimal

stringType' :: SourceAnnotation Text -> Type'
stringType' = Static (SVMType.String Nothing)

bytesType' :: SourceAnnotation Text -> Type'
bytesType' = Static (SVMType.Bytes Nothing Nothing)

boolType' :: SourceAnnotation Text -> Type'
boolType' = Static SVMType.Bool

addressType' :: SourceAnnotation Text -> Type'
addressType' = Static $ SVMType.Address False

accountType' :: SourceAnnotation Text -> Type'
accountType' = Static $ SVMType.Account False

enumType' :: SourceAnnotation Text -> Type'
enumType' = Static (SVMType.Enum Nothing "" Nothing)

contractType' :: SourceAnnotation Text -> Type'
contractType' = Static (SVMType.Contract "")

certType' :: SourceAnnotation Text -> Type'
certType' x = Static (SVMType.Mapping Nothing (SVMType.String Nothing) (SVMType.String Nothing)) x

topType' :: SourceAnnotation Text -> Type'
topType' = Top S.empty

sumType' :: Type' -> Type' -> Type'
sumType' (Sum t1) (Sum t2) = Sum (t1 <> t2)
sumType' (Sum t1) t2 = Sum (t1 <> (t2 :| []))
sumType' t1 (Sum t2) = Sum ((t1 :| []) <> t2)
sumType' t1 t2 = Sum (t1 :| [t2])

sumType :: Type' -> Type' -> Type' -> Type'
sumType (Sum t1) (Sum t2) (Sum t3) = Sum (t1 <> t2 <> t3)
sumType (Sum t1) (Sum t2) t3 = Sum (t1 <> t2 <> (t3 :| []))
sumType (Sum t1) t2 t3 = Sum (t1 <> (t2 :| [t3]))
sumType t1 (Sum t2) (Sum t3) = Sum ((t1 :| []) <> t2 <> t3)
sumType t1 (Sum t2) t3 = Sum ((t1 :| [t3]) <> t2)
sumType t1 t2 (Sum t3) = Sum ((t1 :| [t2]) <> t3)
sumType t1 t2 t3 = Sum (t1 :| [t2, t3])

pickType' :: SourceAnnotation Text -> [Type'] -> Type'
pickType' x [] = bottom x
pickType' _ [t] = t
pickType' x (t : ts) = case t of
  Bottom es -> case pickType' x ts of
    Bottom ess -> Bottom (es <> ess)
    t' -> t'
  _ -> t

reduceType' :: SourceAnnotation Text -> [Type'] -> Type'
reduceType' x [] = Product [] x
reduceType' _ [t] = t
reduceType' x (t : ts) = case (t, reduceType' x ts) of
  (Bottom es, Bottom ess) -> Bottom (es <> ess)
  (_, Bottom ess) -> Bottom ess
  _ -> t

context' :: TypeF' a -> a
context' Top {..} = topContext
context' (Bottom (e :| _)) = e
context' Static {..} = staticContext
context' Product {..} = productContext
context' Function {..} = functionContext
context' (Sum (a :| _)) = context' a
context' MultiVariate {..} = multiVariateContext
context' (SolidVM.Solidity.StaticAnalysis.Typechecker.Modifier _ _ _ a) = a

typecheck' :: Monad m => (SourceAnnotation Text -> SolidString -> Type -> m Type') -> Type' -> Type' -> m Type'
typecheck' unify r1 r2 = case (r1, r2) of
  (Bottom e1, Bottom e2) -> pure $ Bottom (e1 <> e2)
  (Bottom e, _) -> pure $ Bottom e
  (_, Bottom e) -> pure $ Bottom e
  (Top n1 _, Top n2 x) -> pure $ Top (n1 <> n2) x
  (Top names _, m@(Static t x)) -> reduceType' x . (m :) <$> traverse (\n -> unify x n t) (S.toList names)
  (m@(Static t x), Top names _) -> m <$ reduceType' x . (m :) <$> traverse (\n -> unify x n t) (S.toList names)
  (Top _ _, m) -> pure m
  (m, Top _ _) -> pure m
  (t1, Sum t2) -> pickType' (context' t1) <$> traverse (typecheck' unify t1) (NE.toList t2)
  (Sum t1, t2) -> pickType' (context' t2) <$> traverse (flip (typecheck' unify) t2) (NE.toList t1)
  (Static t1 _, Static t2 x) -> pure $ case typecheckStatic t1 t2 of
    Left msg -> bottom $ msg <$ x
    Right t -> Static t x
  (Product t1 x, Product t2 _) -> typecheckProduct unify x t1 t2
  (Product [a] _, b) -> typecheck' unify a b
  (Product [a, (Static SVMType.Variadic _)] _, b) -> typecheck' unify a b
  (a, Product [b] _) -> typecheck' unify a b
  (MultiVariate a _, MultiVariate b _) -> typecheck' unify a b
  (MultiVariate a _, Product xs x) -> typecheckProduct unify x xs (replicate (length xs) a)
  (Product xs x, MultiVariate a _) -> typecheckProduct unify x xs (replicate (length xs) a)
  (MultiVariate a _, b) -> typecheck' unify a b
  (a, MultiVariate b _) -> typecheck' unify a b
  (Function a1 v1 x _ _ _, Function a2 v2 _ _ _ _) -> do
    a <- typecheck' unify a1 a2
    v <- typecheck' unify v1 v2
    pure $ case (a, v) of
      (Bottom es, Bottom ess) -> Bottom (es <> ess)
      (Bottom es, _) -> Bottom es
      (_, Bottom ess) -> Bottom ess
      _ -> Function a v x [] [] False
  (a, b) ->
    pure . bottom $
      ( T.concat
          [ "could not match types ",
            showType' a,
            " and ",
            showType' b,
            "."
          ]
      )
        <$ context' a

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

typecheckProduct :: Monad m => (SourceAnnotation Text -> SolidString -> Type -> m Type') -> SourceAnnotation Text -> [Type'] -> [Type'] -> m Type'
typecheckProduct unify c t1 t2 = typecheckProduct' (Product t1 c) (Product t2 c) t1 t2
  where
    typecheckProduct' _ _ a [Static SVMType.Variadic _] = pure $ Product a c
    typecheckProduct' _ _ [Static SVMType.Variadic _] b = pure $ Product b c
    typecheckProduct' _ _ [] [] = pure $ Product [] c
    typecheckProduct' e a [] _ =
      pure . bottom $
        ( T.concat
            [ "arities do not match. Expected ",
              showType' e,
              ", but got ",
              showType' a,
              "."
            ]
        )
          <$ c
    typecheckProduct' e a _ [] =
      pure . bottom $
        ( T.concat
            [ "arities do not match. Expected ",
              showType' e,
              ", but got ",
              showType' a,
              "."
            ]
        )
          <$ c
    typecheckProduct' e a (x : xs) (y : ys) = do
      t <- typecheck' unify x y
      ts <- typecheckProduct' e a xs ys
      pure $ case (t, ts) of
        (Bottom es, Bottom ess) -> Bottom (es <> ess)
        (Bottom es, _) -> Bottom es
        (_, Bottom es) -> Bottom es
        (t', Product ts' ctx) -> Product (t' : ts') ctx
        (_, _) ->
          bottom $
            ( T.concat
                [ "Could not resolve product type. Expected ",
                  showType' e,
                  ", but got ",
                  showType' a,
                  "."
                ]
            )
              <$ c

string' :: (Eq a, IsString a) => [a] -> a
string' [] = fromString ""
string' ("" : as) = string' as
string' (a : _) = a

typecheckStatic :: Type -> Type -> Either Text Type
typecheckStatic (SVMType.Int s1 b1) (SVMType.Int s2 b2) =
  case (s1, s2) of
    (Just a, Just b) | a /= b -> Left "Mismatched signedness between integer values"
    _ -> case (b1, b2) of
      (Just a, Just b) | a /= b -> Left "Mismatched length between integer values"
      _ -> Right $ SVMType.Int (s1 <|> s2) (b1 <|> b2)
typecheckStatic (SVMType.Int _ _) SVMType.Decimal = Right $ SVMType.Decimal
typecheckStatic (SVMType.String d1) (SVMType.String d2) =
  case (d1, d2) of
    (Just a, Just b) | a /= b -> Left "Mismatched dynamicity between string values"
    _ -> Right $ SVMType.String (d1 <|> d2)
typecheckStatic (SVMType.Bytes d1 b1) (SVMType.Bytes d2 b2) =
  case (d1, d2) of
    (Just a, Just b) | a /= b -> Left "Mismatched dynamicity between bytes values"
    _ -> case (b1, b2) of
      (Just a, Just b) | a /= b -> Left "Mismatched length between bytes values"
      _ -> Right $ SVMType.Bytes (d1 <|> d2) (b1 <|> b2)
typecheckStatic SVMType.Decimal SVMType.Decimal = Right $ SVMType.Decimal
typecheckStatic SVMType.Decimal (SVMType.Int _ _) = Right $ SVMType.Decimal
typecheckStatic SVMType.Bool SVMType.Bool = Right SVMType.Bool
typecheckStatic (SVMType.Address a) (SVMType.Address b) = Right $ SVMType.Account (a && b)
typecheckStatic (SVMType.Address a) (SVMType.Account b) = Right $ SVMType.Account (a && b)
typecheckStatic (SVMType.Account a) (SVMType.Address b) = Right $ SVMType.Account (a && b)
typecheckStatic (SVMType.Account a) (SVMType.Account b) = Right $ SVMType.Account (a && b)
typecheckStatic (SVMType.UnknownLabel a _) (SVMType.UnknownLabel b _) =
  if a == b || a == "" || b == ""
    then Right (SVMType.UnknownLabel (string' [a, b]) Nothing)
    else
      Left $
        "Type mismatch: labels "
          <> labelToText a
          <> " and "
          <> labelToText b
          <> " do not match."
typecheckStatic (SVMType.UnknownLabel a _) b@SVMType.Struct {} =
  typecheckStatic (SVMType.Struct Nothing a) b
typecheckStatic a@SVMType.Struct {} (SVMType.UnknownLabel b _) =
  typecheckStatic a (SVMType.Struct Nothing b)
typecheckStatic (SVMType.Struct b1 t1) (SVMType.Struct b2 t2) =
  case (b1, b2) of
    (Just a, Just b) | a /= b -> Left "Mismatched byte sizes between struct types"
    _ ->
      if t1 == t2 || t1 == "" || t2 == ""
        then Right $ SVMType.Struct (b1 <|> b2) (string' [t1, t2])
        else
          Left $
            "Type mismatch between struct values: "
              <> labelToText t1
              <> " and "
              <> labelToText t2
              <> " do not match."
typecheckStatic (SVMType.UnknownLabel a _) b@SVMType.Enum {} =
  typecheckStatic (SVMType.Enum Nothing a Nothing) b
typecheckStatic a@SVMType.Enum {} (SVMType.UnknownLabel b _) =
  typecheckStatic a (SVMType.Enum Nothing b Nothing)
typecheckStatic (SVMType.Enum b1 t1 n1) (SVMType.Enum b2 t2 n2) =
  case (b1, b2) of
    (Just a, Just b) | a /= b -> Left "Mismatched byte sizes between enum types"
    _ -> case (n1, n2) of
      (Just a, Just b) | a /= b -> Left "Mismatched names between enum types"
      _ ->
        if t1 == t2 || t1 == "" || t2 == ""
          then Right $ SVMType.Enum (b1 <|> b2) (string' [t1, t2]) (n1 <|> n2)
          else
            Left $
              "Type mismatch between enum values: "
                <> labelToText t1
                <> " and "
                <> labelToText t2
                <> " do not match."
typecheckStatic (SVMType.Array t1 l1) (SVMType.Array t2 l2) = do
  e <- typecheckStatic t1 t2
  case (l1, l2) of
    (Just a, Just b) | a /= b -> Left "Mismatched length between array values"
    _ -> Right $ SVMType.Array e (l1 <|> l2)
typecheckStatic (SVMType.UnknownLabel a _) b@SVMType.Contract {} =
  typecheckStatic (SVMType.Contract a) b
typecheckStatic a@SVMType.Contract {} (SVMType.UnknownLabel b _) =
  typecheckStatic a (SVMType.Contract b)
typecheckStatic (SVMType.Contract a) (SVMType.Contract b) =
  if a == b || a == "" || b == ""
    then Right (SVMType.Contract $ string' [a, b])
    else
      Left $
        "Type mismatch: contracts "
          <> labelToText a
          <> " and "
          <> labelToText b
          <> " do not match."
typecheckStatic (SVMType.Mapping d1 k1 v1) (SVMType.Mapping d2 k2 v2) = do
  k <- typecheckStatic k1 k2
  v <- typecheckStatic v1 v2
  case (d1, d2) of
    (Just a, Just b) | a /= b -> Left "Mismatched dynamicity between mapping values"
    _ -> Right $ SVMType.Mapping (d1 <|> d2) k v
typecheckStatic (SVMType.Bytes d1 b1) (SVMType.String _) = Right (SVMType.Bytes d1 b1)
typecheckStatic (SVMType.UserDefined alias1 a) (SVMType.UserDefined alias2 b) =
  if alias1 == alias2 
    then typecheckStatic a b
    else
      Left $
        "Type mismatch Test1: "
          <> showType (SVMType.UserDefined alias1 a)
          <> " and "
          <> showType (SVMType.UserDefined alias2 b)
          <> " do not match."
typecheckStatic (SVMType.UserDefined a c) b =
  Left $
    "Type mismatch: "
      <> showType (SVMType.UserDefined a c)
      <> " and "
      <> showType b
      <> " do not match."
typecheckStatic _ (SVMType.UserDefined _ _) = Left "Type mismatch"
typecheckStatic theType (SVMType.Bytes _ _) = Right theType
typecheckStatic _ SVMType.Variadic = Right SVMType.Variadic
typecheckStatic SVMType.Variadic _ = Right SVMType.Variadic
typecheckStatic t1 t2 =
  Left $
    "Type mismatch: "
      <> showType t1
      <> " and "
      <> showType t2
      <> " do not match."

typecheckIndex :: Type' -> Type' -> SSS Type'
typecheckIndex (Bottom es) (Bottom ess) = pure $ Bottom (es <> ess)
typecheckIndex (Bottom es) _ = pure $ Bottom es
typecheckIndex _ (Bottom es) = pure $ Bottom es
typecheckIndex (Static (SVMType.Array t _) x) i = i ~> (pure $ intType' x) !> pure (Static t x)
typecheckIndex (Product [(Static (SVMType.Array t _) x)] _) i = i ~> (pure $ intType' x) !> pure (Static t x)
typecheckIndex (Static (SVMType.Bytes _ _) x) i = i ~> (pure $ intType' x) !> pure (Static (SVMType.Bytes Nothing (Just 1)) x)
typecheckIndex (Static (SVMType.Mapping _ k v) x) i = do
  t <- typecheck (Static k x) i
  pure $ case t of
    Bottom es -> Bottom es
    _ -> Static v x
typecheckIndex x y =
  pure . bottom $
    ( T.concat
        [ "Mismatched index type: trying to lookup index of type ",
          showType' y,
          " from type ",
          showType' x,
          "."
        ]
    )
      <$ (context' x <> context' y)

typecheckMember :: Type' -> SolidString -> SSS Type'
typecheckMember (Bottom es) _ = pure $ Bottom es
typecheckMember (Sum ts'@(t :| _)) n = pickType' (context' t) <$> traverse (flip typecheckMember n) (NE.toList ts')
typecheckMember (Static (SVMType.Array _ _) x) "length" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.Array t _) x) "push" = pure $ Function (Static t x) (Product [] x) x [] [] False
typecheckMember (Static (SVMType.Array _ _) x) n = pure . bottom $ ("Unknown member of SVMType.Array: " <> labelToText n) <$ x
typecheckMember (Static (SVMType.Bytes _ _) x) "length" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.UnknownLabel "Util" Nothing) x) "bytes32ToString" = pure $ Function (Static (SVMType.Bytes Nothing (Just 32)) x) (Static (SVMType.String Nothing) x) x [] [] False
typecheckMember (Static (SVMType.UnknownLabel "Util" Nothing) x) "b32" = pure $ Function (Static (SVMType.Bytes Nothing (Just 32)) x) (Static (SVMType.Bytes Nothing (Just 32)) x) x [] [] False
typecheckMember (Static (SVMType.UnknownLabel "string" Nothing) x) "concat" = pure $ Function (stringConcatArgs x) (Static (SVMType.String Nothing) x) x [] [] False
typecheckMember (Static (SVMType.UnknownLabel "msg" Nothing) x) "sender" = pure $ Static (SVMType.Account False) x
typecheckMember (Static (SVMType.UnknownLabel "msg" Nothing) x) "data" = pure $ Static (SVMType.String Nothing) x
typecheckMember (Static (SVMType.UnknownLabel "msg" Nothing) x) "sig" = pure $ Static (SVMType.Bytes Nothing (Just 4)) x
typecheckMember (Static (SVMType.UnknownLabel "tx" Nothing) x) "origin" = pure $ Static (SVMType.Account False) x
typecheckMember (Static (SVMType.UnknownLabel "tx" Nothing) x) "username" = pure $ Static (SVMType.String Nothing) x
typecheckMember (Static (SVMType.UnknownLabel "tx" Nothing) x) "organization" = pure $ Static (SVMType.String Nothing) x
typecheckMember (Static (SVMType.UnknownLabel "tx" Nothing) x) "group" = pure $ Static (SVMType.String Nothing) x
typecheckMember (Static (SVMType.UnknownLabel "tx" Nothing) x) "organizationalUnit" = pure $ Static (SVMType.String Nothing) x
typecheckMember (Static (SVMType.UnknownLabel "tx" Nothing) x) "certificate" = pure $ Static (SVMType.String Nothing) x
typecheckMember (Static (SVMType.UnknownLabel "block" Nothing) x) "timestamp" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.UnknownLabel "block" Nothing) x) "number" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.UnknownLabel "block" Nothing) x) "coinbase" = pure $ Static (SVMType.Account True) x
typecheckMember (Static (SVMType.UnknownLabel "block" Nothing) x) "difficulty" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.UnknownLabel "block" Nothing) x) "gaslimit" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.UnknownLabel "block" Nothing) x) "proposer" = pure $ Static (SVMType.Account False) x
typecheckMember (Static (SVMType.UnknownLabel "type" Nothing) x) "name" = pure $ (Static (SVMType.String Nothing) x)
typecheckMember (Static (SVMType.UnknownLabel "type" Nothing) x) "creationCode" = pure $ (Static (SVMType.String Nothing) x)
typecheckMember (Static (SVMType.UnknownLabel "type" Nothing) x) "runtimeCode" = pure $ (Static (SVMType.String Nothing) x)
--typecheckMember (Static (SVMType.UnknownLabel "type" Nothing) x) "min"         = pure $  (Static (SVMType.Int Nothing Nothing) x) --Implement for next ticket
--typecheckMember (Static (SVMType.UnknownLabel "type" Nothing) x) "max"         = pure $  (Static (SVMType.Int Nothing Nothing) x)

typecheckMember (Static (SVMType.UnknownLabel "super" Nothing) x) method = do
  ctract <- asks contract
  cc <- asks codeCollection
  pure $ case getParents ((fmap $ const ()) <$> cc) ((fmap $ const ()) <$> ctract) of
    Left _ -> bottom $ "Contract has missing parents" <$ x
    Right parents' -> case filter (elem method . M.keys . _functions) parents' of
      [] -> bottom $ "cannot use super without a parent contract" <$ x
      ps -> case M.lookup method . _functions $ last ps of
        Nothing -> bottom $ ("super does not have a function called " <> labelToText method) <$ x
        Just f -> filterFuncs cc x method (("" <$) <$> f) [External, Private]
typecheckMember (Static e@(SVMType.Enum _ enum mNames) x) n = do
  names <- case mNames of
    Just names -> pure names
    Nothing -> lookupEnum enum
  pure $
    if n `elem` names
      then Static e x
      else
        bottom $
          ( T.concat
              [ "Missing enum element: ",
                labelToText n,
                " is not an element of ",
                labelToText enum
              ]
          )
            <$ x

-- Function: argType, returnType, contextType
-- Static: argType, ContextType
typecheckMember (Static (SVMType.Account True) x) "transfer" = pure $ Function (Static (SVMType.Int Nothing Nothing) x) (Product [] x) x [] [] False
typecheckMember (Static (SVMType.Account True) x) "send" = pure $ Function (Static (SVMType.Int Nothing Nothing) x) (Static (SVMType.Bool) x) x [] [] False
typecheckMember (Static (SVMType.Account _) x) "nonce" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.Account _) x) "balance" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.Account _) x) "code" =
  pure . Sum $
    (Static (SVMType.String Nothing) x)
      :| [ Function
             (Sum $ (Product [] x) :| [Static (SVMType.String Nothing) x])
             (Static (SVMType.String Nothing) x)
             x
             []
             []
             False
         ]
typecheckMember (Static (SVMType.Account _) x) "codehash" = pure $ Static (SVMType.String Nothing) x
typecheckMember (Static (SVMType.Account _) x) "chainId" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.Account _) x) "chainIdString" = pure $ Static (SVMType.String Nothing) x
typecheckMember (Static (SVMType.Account _) x) "creator" = pure $ Static (SVMType.String Nothing) x
typecheckMember (Static (SVMType.Address _) x) "creator" = pure $ Static (SVMType.String Nothing) x
typecheckMember (Static (SVMType.Account _) x) "root" = pure $ Static (SVMType.Account False) x
typecheckMember (Static (SVMType.Address _) x) "root" = pure $ Static (SVMType.Account False) x
typecheckMember (Static (SVMType.Struct _ struct) x) n = do
  names <- M.fromList <$> lookupStruct struct
  pure $ case M.lookup n names of
    Just t -> Static t x
    Nothing ->
      bottom $
        ( T.concat
            [ "Missing struct element: ",
              labelToText n,
              " is not a field of ",
              labelToText struct
            ]
        )
          <$ x
-- I'm intentionally leaving out send and transfer for Contract types, since we don't have a payable flag for them yet
typecheckMember (Static (SVMType.Contract _) x) "nonce" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.Contract _) x) "balance" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.Contract _) x) "code" =
  pure . Sum $
    (Static (SVMType.String Nothing) x)
      :| [ Function
             (Sum $ (Product [] x) :| [Static (SVMType.String Nothing) x])
             (Static (SVMType.String Nothing) x)
             x
             []
             []
             False
         ]
-- Sum $ (Product [] x) :| [(Static (SVMType.Bytes Nothing Nothing) x), (Function (Static (SVMType.String Nothing) x) (Static (SVMType.String Nothing) x) x)]
-- typecheckMember (Static (SVMType.Contract _) x) "searchcode" = pure $ Function (Static (SVMType.String Nothing) x) (Static (SVMType.String Nothing) x) x
typecheckMember (Static (SVMType.Contract _) x) "codehash" = pure $ Static (SVMType.String Nothing) x
typecheckMember (Static (SVMType.Contract _) x) "chainId" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.Contract _) x) "root" = pure $ Static (SVMType.Account False) x
typecheckMember (Static (SVMType.Contract c) x) n = lookupContractFunction x c n
typecheckMember (Static (SVMType.UnknownLabel c _) x) n = do
  e <- typecheckMember (Static (SVMType.Enum Nothing c Nothing) x) n
  case e of
    Bottom _ -> do
      s <- typecheckMember (Static (SVMType.Struct Nothing c) x) n
      case s of
        Bottom _ -> do
          f <- typecheckMember (Static (SVMType.Contract c) x) n
          case f of
            Bottom _ ->
              pure . bottom $
                ( T.concat
                    [ "Missing label: ",
                      labelToText c,
                      (T.pack (show f)),
                      " is not a known enum, struct, or contract."
                    ]
                )
                  <$ x
            t -> pure t
        t -> pure t
    t -> pure t
typecheckMember t@(Static svmType x) n = do
  let unknownMember = pure . bottom $ ("Unknown member: " <> showType svmType <> "." <> labelToText n) <$ x
  c <- asks contract
  case c ^. usings . at (T.unpack $ showType svmType) of
    Nothing -> unknownMember
    Just [] -> unknownMember
    Just us -> do
      results <- forM us $ \(Using c' _ _) -> do
        ~CodeCollection {..} <- asks codeCollection
        case M.lookup c' _contracts of
          Nothing -> unknownMember
          Just c'' -> do
            r <- ask
            s <- get
            let fType' = flip runReader r {contract = c''} . flip evalStateT s $ getVarTypeByName' n x
            case fType' of
              Function (Product (a : as) x') rs x'' ovs names _ ->
                typecheck a t !> (pure $ Function (Product as x') rs x'' ovs names False)
              _ -> unknownMember
      pure $ pickType' x results
typecheckMember x n = pure . bottom $ ("Unknown member: " <> showType' x <> "." <> labelToText n) <$ context' x

typecheckFuncs :: Annotated CodeCollectionF -> SourceAnnotation Text -> SolidString -> Annotated FuncF -> Annotated FuncF -> Type'
typecheckFuncs cc x n f g = runIdentity $ typecheck' ignoreTops (functionType cc x n f) (functionType cc x n g)

getConstructorType' :: MonadReader R m => SourceAnnotation Text -> SolidString -> m Type'
getConstructorType' x l = do
  ~CodeCollection {..} <- asks codeCollection
  case M.lookup l _contracts of
    Nothing -> do
      --look through all the contracts get the _modifiers maps and check to see if l is a key in there

      let allModifierMap = M.unions $ map ((Con._modifiers) . snd) (M.toList _contracts)
      case M.lookup l allModifierMap of
        Nothing -> pure . bottom $ ("Unknown Contract or Modifier: " <> labelToText l) <$ x
        Just _ -> pure $ Top (S.singleton l) x
    Just c -> case _constructor c of
      Nothing -> pure $ Function (Product [] x) (Static (SVMType.Contract l) x) x [] [] False
      Just Func {..} ->
        let fArgs = flip Product x $ flip Static x . indexedTypeType . snd <$> _funcArgs
         in pure $ Function fArgs (Static (SVMType.Contract l) x) x [] [] False

getTypeErrors :: Type' -> [SourceAnnotation Text]
getTypeErrors (Bottom ts) = NE.toList ts
getTypeErrors _ = []

const' :: Type' -> Type' -> Type'
const' _ (Bottom e) = Bottom e
const' t _ = t

-- type CompilerDetector = CodeCollection -> [SourceAnnotation T.Text]
detector :: CompilerDetector
detector cc =
  let cc'@CodeCollection {..} = (\sa -> sa {_sourceAnnotationAnnotation = ""}) <$> cc
   in fromMaybe []
        . fmap (\(a :| as) -> getTypeErrors $ reduceType' emptyAnnotation (a : as))
        . NE.nonEmpty
        $ contractHelper cc'
          <$> M.elems _contracts

contractHelper ::
  Annotated CodeCollectionF ->
  Annotated ContractF ->
  Type'
contractHelper cc c =
  if isSVMVersion "11.4" cc
    then
      let constr = maybe M.empty (M.singleton "constructor") $ _constructor c
          funcsAndConstr = constr <> _functions c 
          varTypes' = reduceType' (_contractContext c) $ varDeclHelper cc c <$> M.elems (_storageDefs c)
          constTypes' = reduceType' (_contractContext c) $ constDeclHelper cc c <$> M.elems (_constants c)
          constTypes'' = reduceType' (_contractContext c) $ constDeclHelper cc c <$> M.elems (_flConstants cc)
          funcTypes' = reduceType' (_contractContext c) $ uncurry (functionHelper cc c) <$> M.toList funcsAndConstr
          modifierTypes' = reduceType' (_contractContext c) $ modifierHelper cc c <$> M.elems (_modifiers c)
      in reduceType' (_contractContext c) [varTypes', constTypes', funcTypes', constTypes'', modifierTypes']
    else 
      let constr = maybe M.empty (M.singleton "constructor") $ _constructor c
          funcsAndConstr = constr <> _functions c 
          varTypes' = reduceType' (_contractContext c) $ varDeclHelper cc c <$> M.elems (_storageDefs c)
          constTypes' = reduceType' (_contractContext c) $ constDeclHelper cc c <$> M.elems (_constants c)
          constTypes'' = reduceType' (_contractContext c) $ constDeclHelper cc c <$> M.elems (_flConstants cc)
          funcTypes' = reduceType' (_contractContext c) $ uncurry (functionHelper cc c) <$> M.toList funcsAndConstr
      in reduceType' (_contractContext c) [varTypes', constTypes', funcTypes', constTypes'']

varDeclHelper ::
  Annotated CodeCollectionF ->
  Annotated ContractF ->
  Annotated VariableDeclF ->
  Type'
varDeclHelper cc c VariableDecl {..} =
  let ty = Static _varType _varContext
   in case _varInitialVal of
        Nothing -> ty
        Just e ->
          let r = R cc c Nothing (Just "Nothing") Nothing []
           in runReader (evalStateT (ty ~> tcExpr e) ((Nothing, M.empty) :| [])) r

constDeclHelper ::
  Annotated CodeCollectionF ->
  Annotated ContractF ->
  Annotated ConstantDeclF ->
  Type'
constDeclHelper cc c ConstantDecl {..} =
  let ty = Static _constType _constContext
      r = R cc c Nothing (Just "Nothing") Nothing []
   in runReader (evalStateT (ty ~> tcExpr _constInitialVal) ((Nothing, M.empty) :| [])) r

checkOverrides ::
  Annotated CodeCollectionF ->
  Annotated ContractF ->
  SolidString ->
  Annotated FuncF ->
  Type'
checkOverrides cc c funcName f =
  let ctx = f ^. funcContext
      mOs = f ^. funcOverrides
      tFuncName = T.pack funcName
      parentsWithSameFunc =
        catMaybes $
          sequence . (_contractName &&& (M.lookup funcName . _functions))
            <$> catMaybes (flip M.lookup (cc ^. contracts) <$> c ^. parents)
   in case parentsWithSameFunc of
        [] -> case mOs of
          Nothing -> functionType cc ctx funcName f
          Just _ -> bottom $ "Function " <> tFuncName <> " is declared override, but none of its parents have a function by the same name" <$ ctx
        p : ps -> case mOs of
          Nothing ->
            bottom $
              T.concat
                [ "Function ",
                  tFuncName,
                  " is not marked as override, but its parent(s) ",
                  T.intercalate ", " $ T.pack . fst <$> parentsWithSameFunc,
                  " have a function by the same name"
                ]
                <$ ctx
          Just [] -> case ps of
            [] -> typecheckFuncs cc ctx funcName f $ snd p
            _ ->
              bottom $
                T.concat
                  [ "Function ",
                    tFuncName,
                    " is marked as override, but does not specify which base contract to override. Options include ",
                    T.intercalate ", " $ T.pack . fst <$> parentsWithSameFunc
                  ]
                  <$ ctx
          Just os ->
            let parentMap = M.fromList parentsWithSameFunc
                parentFuncs = flip M.lookup parentMap <$> os
                invalidParentFuncs =
                  foldr
                    ( \a (ns, vs, es) -> case a of
                        (o, Nothing) -> (o : ns, vs, es)
                        (o, Just f') ->
                          if f' ^. funcVirtual
                            then case typecheckFuncs cc ctx funcName f f' of
                              Bottom e -> (ns, vs, (o, e) : es)
                              _ -> (ns, vs, es)
                            else (ns, o : vs, es)
                    )
                    ([], [], [])
                    $ zip os parentFuncs
             in case invalidParentFuncs of
                  ([], [], []) -> functionType cc ctx funcName f
                  (ns, vs, es) ->
                    let nMsg =
                          T.concat
                            [ "The following parent contracts don't have a function named ",
                              tFuncName,
                              ": ",
                              T.intercalate ", " $ labelToText <$> ns,
                              "\n"
                            ]
                        vMsg =
                          T.concat
                            [ "The following parent contracts don't have ",
                              tFuncName,
                              " marked as virtual: ",
                              T.intercalate ", " $ labelToText <$> vs,
                              "\n"
                            ]
                        eMsg =
                          T.concat
                            [ "The following parent contracts' signatures for ",
                              tFuncName,
                              " don't match the one found in ",
                              labelToText $ c ^. contractName,
                              ": ",
                              T.intercalate ", " $ (\(o, e) -> "In " <> labelToText o <> ":\n  " <> T.pack (concatMap (("\n  " ++) . show) e)) <$> es,
                              "\n"
                            ]
                     in bottom $
                          bool nMsg "" (null ns)
                            <> bool vMsg "" (null vs)
                            <> bool eMsg "" (null es)
                            <$ ctx

modifierHelper ::
  Annotated CodeCollectionF ->
  Annotated ContractF ->
  Annotated ModifierF ->
  Type'
modifierHelper cc c m@SolidVM.Model.CodeCollection.Modifier {..} = 
  let r =
        R cc c Nothing Nothing (Just m) $
          map
            (fmap $ isJust . _varInitialVal)
            (filter (_isImmutable . snd) . M.toList $ _storageDefs c)
      swap = uncurry $ flip (,)
      args =
        ( \(it, n) ->
            ( T.unpack n,
              VarDefEntry (Just $ indexedTypeType it) Nothing (T.unpack n) _modifierContext
            )
        )
          <$> (swap <$> _modifierArgs)
      contents' = case m ^. SolidVM.Model.CodeCollection.modifierContents of
                    Nothing       -> []
                    Just contents -> contents
    in runReader (statementsHelperM (M.fromList args) contents') r

functionHelper ::
  Annotated CodeCollectionF ->
  Annotated ContractF ->
  SolidString ->
  Annotated FuncF ->
  Type'
functionHelper cc c funcName f@Func {..} =
  let check =
        if usesStrictModifiers cc
          then checkOverrides cc c funcName f
          else functionType cc (f ^. funcContext) funcName f
   in unlessBottom check $ \t' -> case f ^. funcContents of
        Nothing -> t'
        Just stmts ->
          if (funcName == "receive")
            then case (_funcArgs, _funcVals, _funcStateMutability, _funcVisibility) of
              ([], [], Just Payable, Just External) ->
                let r =
                      R cc c (Just f) (Just funcName) Nothing $
                        map
                          (fmap $ isJust . _varInitialVal)
                          (filter (_isImmutable . snd) . M.toList $ _storageDefs c)
                    swap = uncurry $ flip (,)
                    args =
                      ( \(it, n) ->
                          ( n,
                            VarDefEntry (Just $ indexedTypeType it) Nothing n _funcContext
                          )
                      )
                        <$> (catMaybes $ sequence . swap <$> _funcArgs)
                    vals =
                      ( \(it, n) ->
                          ( n,
                            VarDefEntry (Just $ indexedTypeType it) Nothing n _funcContext
                          )
                      )
                        <$> (catMaybes $ sequence . swap <$> _funcVals)
                    argVals = M.fromList $ args ++ vals
                 in runReader (statementsHelper argVals stmts) r
              ([fArg], _, _, _) ->
                bottom $
                  ( T.concat
                      [ "Function `receive` must take no arguments, but has been given ",
                        T.pack $ show fArg
                      ]
                  )
                    <$ _funcContext
              (_, [fVal], _, _) ->
                bottom $
                  ( T.concat
                      [ "Function `receive` must have no return values, but has been given ",
                        T.pack $ show fVal
                      ]
                  )
                    <$ _funcContext
              _ -> bottom $ "Function `receive` must be External and Payable, but has not been declared so " <$ _funcContext
            else
              if (funcName == "fallback")
                then case (_funcArgs, _funcVals, _funcVisibility) of
                  ([], [], Just External) ->
                    let r =
                          R cc c (Just f) (Just funcName) Nothing $
                            map
                              (fmap $ isJust . _varInitialVal)
                              (filter (_isImmutable . snd) . M.toList $ _storageDefs c)
                        swap = uncurry $ flip (,)
                        args =
                          ( \(it, n) ->
                              ( n,
                                VarDefEntry (Just $ indexedTypeType it) Nothing n _funcContext
                              )
                          )
                            <$> (catMaybes $ sequence . swap <$> _funcArgs)
                        vals =
                          ( \(it, n) ->
                              ( n,
                                VarDefEntry (Just $ indexedTypeType it) Nothing n _funcContext
                              )
                          )
                            <$> (catMaybes $ sequence . swap <$> _funcVals)
                        argVals = M.fromList $ args ++ vals
                     in runReader (statementsHelper argVals stmts) r
                  ([fArg], _, _) ->
                    bottom $
                      ( T.concat
                          [ "Function `fallback` must take no arguments, but has been given ",
                            T.pack $ show fArg
                          ]
                      )
                        <$ _funcContext
                  (_, [fVal], _) ->
                    bottom $
                      ( T.concat
                          [ "Function `fallback` must have no return values, but has been given ",
                            T.pack $ show fVal
                          ]
                      )
                        <$ _funcContext
                  _ -> bottom $ "Function `fallback` must be External, but has not been declared so " <$ _funcContext
            else
              let r =
                    R cc c (Just f) (Just funcName) Nothing $
                      map
                        (fmap $ isJust . _varInitialVal)
                        (filter (_isImmutable . snd) . M.toList $ _storageDefs c)
                  swap = uncurry $ flip (,)
                  args =
                    ( \(it, n) ->
                        ( n,
                          VarDefEntry (Just $ indexedTypeType it) Nothing n _funcContext
                        )
                    )
                      <$> (catMaybes $ sequence . swap <$> _funcArgs)
                  vals =
                    ( \(it, n) ->
                        ( n,
                          VarDefEntry (Just $ indexedTypeType it) Nothing n _funcContext
                        )
                    )
                      <$> (catMaybes $ sequence . swap <$> _funcVals)
                  argVals = M.fromList $ args ++ vals
               in flip runReader r $ do
                    mods <- flip evalStateT ((Nothing, argVals) :| []) $
                      reduceType' _funcContext <$> traverse (uncurry checkModifier) _funcModifiers
                    ret <- statementsHelper argVals stmts
                    pure $ reduceType' _funcContext [ret, mods]
                  where checkModifier modName modArgs = do
                          if isSVMVersion "11.4" cc
                            then do
                              e <- getModifierByNameRecursively funcName modName _funcContext
                              a <- productType' _funcContext <$> traverse tcExpr modArgs
                              apply e a Nothing
                            else pure $ topType' _funcContext

statementsHelperM ::
  (M.Map SolidString (Annotated VarDefEntryF)) ->
  [Annotated StatementF] ->
  Reader R Type'
statementsHelperM args ss = do
  fm <- asks modifier
  case fm of
    Nothing -> do
      x <- asks $ _contractContext . contract
      modifierError "you cannot return a value as part of a modifier" (x)
    Just m -> do
      let x = _modifierContext m
      ~(ts', s) <- flip runStateT ((Nothing, args) :| []) $ traverse statementHelper ss
      let ret = case fst $ NE.head s of
            Nothing -> Product [] x
            Just (Sum rs) ->
              runIdentity $
                foldr
                  ( \a mb ->
                      mb >>= \b -> case (a, b) of
                        (Bottom es, Bottom ess) -> pure $ Bottom (es <> ess)
                        (Bottom es, _) -> pure $ Bottom es
                        (_, Bottom ess) -> pure $ Bottom ess
                        _ -> do
                          t' <- typecheck' ignoreTops a b
                          case t' of
                            Bottom _ -> pure . bottom $ "not all paths return a value." <$ x
                            _ -> pure t'
                  )
                  (pure $ topType' x)
                  (NE.toList rs)
            Just r -> r
      pure $ reduceType' x $ ret : ts'   

statementsHelper ::
  (M.Map SolidString (Annotated VarDefEntryF)) ->
  [Annotated StatementF] ->
  Reader R Type'
statementsHelper args ss = do
  mf <- asks function
  case mf of
    Nothing -> do
      x <- asks $ _contractContext . contract
      pure . bottom $ "Cannot use keyword 'return' outside of a function" <$ x
    Just f -> do
      let x = _funcContext f
      ~(ts', s) <- flip runStateT ((Nothing, args) :| []) $ traverse statementHelper ss
      let ret = case fst $ NE.head s of
            Nothing -> Product [] x
            Just (Sum rs) ->
              runIdentity $
                foldr
                  ( \a mb ->
                      mb >>= \b -> case (a, b) of
                        (Bottom es, Bottom ess) -> pure $ Bottom (es <> ess)
                        (Bottom es, _) -> pure $ Bottom es
                        (_, Bottom ess) -> pure $ Bottom ess
                        _ -> do
                          t' <- typecheck' ignoreTops a b
                          case t' of
                            Bottom _ -> pure . bottom $ "not all paths return a value." <$ x
                            _ -> pure t'
                  )
                  (pure $ topType' x)
                  (NE.toList rs)
            Just r -> r
      pure $ reduceType' x $ ret : ts'

statementsHelper' :: SourceAnnotation Text -> [Annotated StatementF] -> SSS Type'
statementsHelper' x stmts = do
  modify $ NE.cons (Nothing, M.empty)
  anns <- reduceType' x <$> traverse statementHelper stmts
  modify $ \case
    _ :| [] -> error "statementsHelper': Stack underflow"
    (r, _) :| ((s, l) : rest) -> case (r, s) of
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
intArgs x =
  Sum $
    enumType' x
      :| [ intType' x,
           stringType' x,
           decimalType' x,
           Product [stringType' x, intType' x] x
         ]
    
decimalArgs :: SourceAnnotation Text -> Type'
decimalArgs x =
  Sum $
    intType' x
      :| [ stringType' x,
           decimalType' x 
         ]

stringArgs :: SourceAnnotation Text -> Type'
stringArgs x =
  Sum $
    stringType' x
      :| [ addressType' x,
           accountType' x,
           intType' x,
           boolType' x
         ]

addressArgs :: SourceAnnotation Text -> Type'
addressArgs x =
  Sum $
    stringType' x
      :| [ addressType' x,
           accountType' x,
           intType' x,
           contractType' x
         ]

accountArgs :: SourceAnnotation Text -> Type'
accountArgs x =
  Sum $
    stringType' x
      :| [ addressType' x,
           accountType' x,
           intType' x,
           contractType' x,
           Product [intType' x, intType' x] x,
           Product [intType' x, stringType' x] x,
           Product [addressType' x, intType' x] x,
           Product [accountType' x, intType' x] x,
           Product [addressType' x, stringType' x] x,
           Product [accountType' x, stringType' x] x
         ]

boolArgs :: SourceAnnotation Text -> Type'
boolArgs x =
  Sum $
    stringType' x
      :| [ boolType' x
         ]

byteArgs :: SourceAnnotation Text -> Type'
byteArgs x = intType' x

keccak256Args :: SourceAnnotation Text -> Type'
keccak256Args x = MultiVariate (stringType' x) x

sha256Args :: SourceAnnotation Text -> Type'
sha256Args x = MultiVariate (stringType' x) x

ripemd160Args :: SourceAnnotation Text -> Type'
ripemd160Args x = MultiVariate (stringType' x) x

--This function should have multivariate type that represents any amount of string types
stringConcatArgs :: SourceAnnotation Text -> Type'
stringConcatArgs x = MultiVariate (stringType' x) x

requireArgs :: SourceAnnotation Text -> Type'
requireArgs x =
  Sum $
    boolType' x
      :| [ Product [boolType' x, topType' x] x
         ]

assertArgs :: SourceAnnotation Text -> Type'
assertArgs x = boolType' x

verifyCertArgs :: SourceAnnotation Text -> Type'
verifyCertArgs x = Product [stringType' x, stringType' x] x

verifyCertSignedByArgs :: SourceAnnotation Text -> Type'
verifyCertSignedByArgs x = Product [stringType' x, stringType' x] x

verifySignatureArgs :: SourceAnnotation Text -> Type'
verifySignatureArgs x = Product [stringType' x, stringType' x, stringType' x] x

selfdestructArgs :: SourceAnnotation Text -> Type'
selfdestructArgs x = accountType' x

getUserCertArgs :: SourceAnnotation Text -> Type'
getUserCertArgs x = accountType' x

mulmodArgs :: SourceAnnotation Text -> Type'
mulmodArgs x = Product [intType' x, intType' x, intType' x] x

blockhashArgs :: SourceAnnotation Text -> Type'
blockhashArgs x = intType' x

ecrecoverArgs :: SourceAnnotation Text -> Type'
ecrecoverArgs x = Product [stringType' x, intType' x, stringType' x, stringType' x] x

addmodArgs :: SourceAnnotation Text -> Type'
addmodArgs x = Product [intType' x, intType' x, intType' x] x

payableArgs :: SourceAnnotation Text -> Type'
payableArgs x = accountType' x

parseCertArgs :: SourceAnnotation Text -> Type'
parseCertArgs x = stringType' x

createFuncArgs :: SourceAnnotation Text -> Type'
createFuncArgs x = Product [stringType' x, stringType' x, stringType' x] x

saltCreateArgs :: SourceAnnotation Text -> Type'
saltCreateArgs x = Product [stringType' x, stringType' x, stringType' x, stringType' x] x

getVarType' :: String -> SourceAnnotation Text -> SSS Type'
getVarType' "this" ctx = pure $ Static (SVMType.Account False) ctx
getVarType' s@('u' : 'i' : 'n' : 't' : n) ctx = case n of
  [] -> pure $ Function (intArgs ctx) (Static (SVMType.Int (Just False) Nothing) ctx) ctx [] [] False
  _ -> case readMaybe n of
    Just n' -> pure $ Function (intArgs ctx) (Static (SVMType.Int (Just False) (Just n')) ctx) ctx [] [] False
    Nothing -> getVarTypeByName' (stringToLabel s) ctx
getVarType' s@('i' : 'n' : 't' : n) ctx = case n of
  [] -> pure $ Function (intArgs ctx) (Static (SVMType.Int (Just True) Nothing) ctx) ctx [] [] False
  _ -> case readMaybe n of
    Just n' -> pure $ Function (intArgs ctx) (Static (SVMType.Int (Just True) (Just n')) ctx) ctx [] [] False
    Nothing -> getVarTypeByName' (stringToLabel s) ctx
getVarType' "address" ctx = pure $ Function (addressArgs ctx) (Static (SVMType.Account False) ctx) ctx [] [] False
getVarType' "account" ctx = pure $ Function (accountArgs ctx) (Static (SVMType.Account False) ctx) ctx [] [] False
--This is either the string() function or the string.member() function
getVarType' "string" ctx = pure $ Sum $ (Function (stringArgs ctx) (stringType' ctx) ctx [] [] False) :| [Static (SVMType.UnknownLabel "string" Nothing) ctx]
getVarType' "decimal" ctx = pure $ Function (decimalArgs ctx) (Static (SVMType.Decimal) ctx) ctx [] [] False
getVarType' "bool" ctx = pure $ Function (boolArgs ctx) (boolType' ctx) ctx [] [] False
getVarType' s@('b' : 'y' : 't' : 'e' : 's' : n) ctx = case n of
  [] -> pure $ Function (byteArgs ctx) (Static (SVMType.Bytes Nothing Nothing) ctx) ctx [] [] False
  _ -> case readMaybe n of
    Just n' -> pure $ Function (byteArgs ctx) (Static (SVMType.Bytes Nothing (Just n')) ctx) ctx [] [] False
    Nothing -> getVarTypeByName' (stringToLabel s) ctx
getVarType' "byte" ctx = pure $ Function (byteArgs ctx) (intType' ctx) ctx [] [] False
getVarType' "push" ctx = pure $ Function (topType' ctx) (Product [] ctx) ctx [] [] False
getVarType' "identity" ctx = pure $ Function (topType' ctx) (topType' ctx) ctx [] [] False
getVarType' "keccak256" ctx = pure $ Function (keccak256Args ctx) (stringType' ctx) ctx [] [] False
getVarType' "sha256" ctx = pure $ Function (sha256Args ctx) (stringType' ctx) ctx [] [] False
getVarType' "ripemd160" ctx = pure $ Function (ripemd160Args ctx) (stringType' ctx) ctx [] [] False
getVarType' "selfdestruct" ctx = pure $ Function (selfdestructArgs ctx) (boolType' ctx) ctx [] [] False
getVarType' "require" ctx = pure $ Function (requireArgs ctx) (Product [] ctx) ctx [] [] False
getVarType' "assert" ctx = pure $ Function (assertArgs ctx) (Product [] ctx) ctx [] [] False
getVarType' "verifyCert" ctx = pure $ Function (verifyCertArgs ctx) (boolType' ctx) ctx [] [] False
getVarType' "verifyCertSignedBy" ctx = pure $ Function (verifyCertSignedByArgs ctx) (boolType' ctx) ctx [] [] False
getVarType' "verifySignature" ctx = pure $ Function (verifySignatureArgs ctx) (boolType' ctx) ctx [] [] False
getVarType' "getUserCert" ctx = pure $ Function (getUserCertArgs ctx) (certType' ctx) ctx [] [] False
getVarType' "addmod" ctx = pure $ Function (addmodArgs ctx) (intType' ctx) ctx [] [] False
getVarType' "mulmod" ctx = pure $ Function (mulmodArgs ctx) (intType' ctx) ctx [] [] False
getVarType' "payable" ctx = pure $ Function (payableArgs ctx) (Static (SVMType.Account True) ctx) ctx [] [] False
getVarType' "blockhash" ctx = pure $ Function (blockhashArgs ctx) (stringType' ctx) ctx [] [] False
getVarType' "ecrecover" ctx = pure $ Function (ecrecoverArgs ctx) (addressType' ctx) ctx [] [] False
getVarType' "parseCert" ctx = pure $ Function (parseCertArgs ctx) (certType' ctx) ctx [] [] False
getVarType' "create" ctx = pure $ Function (createFuncArgs ctx) (accountType' ctx) ctx [] [] False
getVarType' "create2" ctx = pure $ Function (saltCreateArgs ctx) (accountType' ctx) ctx [] [] False
getVarType' "Util" ctx = pure $ Static (SVMType.UnknownLabel "Util" Nothing) ctx
getVarType' "msg" ctx = pure $ Static (SVMType.UnknownLabel "msg" Nothing) ctx
getVarType' "tx" ctx = pure $ Static (SVMType.UnknownLabel "tx" Nothing) ctx
getVarType' "block" ctx = pure $ Static (SVMType.UnknownLabel "block" Nothing) ctx
getVarType' "super" ctx = pure $ Static (SVMType.UnknownLabel "super" Nothing) ctx
getVarType' name ctx = do
  c <- asks contract
  let varDefy = M.lookup name (_storageDefs c)
  case varDefy of
    Just _ -> do
      case _varType <$> varDefy of
        Just (SVMType.UserDefined ggg b) -> return (Static (SVMType.UserDefined ggg b) ctx)
        _ -> getVarTypeByName' (stringToLabel name) ctx
    Nothing -> do
      let ls = filter (userDefinedHelper name) [_varType x | x <- (M.elems (_storageDefs c))]
      if length ls > 0
        then do
          let ls2 = head (filter (userDefinedHelper name . _varType) [x | x <- (M.elems (_storageDefs c))])
          case _varInitialVal ls2 of
            Just _ -> pure $ (Static (head ls) ctx)
            _ -> pure $ (Static (SVMType.actual (head ls)) ctx)
        else do
          getVarTypeByName' (stringToLabel name) ctx

userDefinedHelper :: String -> Type -> Bool
userDefinedHelper nam (SVMType.UserDefined a _) = if a == nam then True else False
userDefinedHelper _ _ = False

userTypeHelper' :: Maybe String -> SVMType.Type
userTypeHelper' (Just "bool") = SVMType.Bool
userTypeHelper' (Just "string") = SVMType.String $ Just True
userTypeHelper' (Just "int") = (SVMType.Int (Just True) Nothing)
userTypeHelper' (Just "uint") = (SVMType.Int (Just False) Nothing)
userTypeHelper' (Just "bytes") = (SVMType.Bytes (Just True) Nothing)
userTypeHelper' (Just "byte") = (SVMType.Bytes Nothing $ Just 1)
userTypeHelper' _ = SVMType.Bool --TODO fix this

getFunctionByNameRecursively :: SolidString -> SourceAnnotation Text -> SSS Type'
getFunctionByNameRecursively name ctx = go False
  where
    go isParent = do
      c <- asks contract
      cc <- asks codeCollection
      case M.lookup name $ c ^. functions of
        Just theFunc -> pure $ filterFuncs cc ctx name theFunc $ External : bool [] [Private] isParent
        Nothing -> case M.lookup name $ c ^. events of
          Just theEvent -> pure $ eventType ctx theEvent
          Nothing -> pickType' ctx <$> traverse recurse (c ^. parents)
    recurse parentName = do
      cc <- asks codeCollection
      case M.lookup parentName $ cc ^. contracts of
        Nothing -> pure . bottom $ "Could not find parent contract " <> T.pack parentName <$ ctx
        Just c' -> local (\r -> r {contract = c'}) $ go True

getModifierByNameRecursively :: SolidString -> SolidString -> SourceAnnotation Text -> SSS Type'
getModifierByNameRecursively funcName name ctx = go
  where
    go = do
      c <- asks contract
      case M.lookup name $ c ^. modifiers of
        Just theMod -> pure $ modifierType ctx theMod
        Nothing -> do
          cc <- asks codeCollection
          case M.lookup name $ cc ^. contracts of
            Just c' -> if funcName /= "constructor"
              then pure . bottom $ "Parent constructors can only be invoked from the contract's constructor" <$ ctx
              else case c' ^. constructor of
                Just f -> pure $ functionType cc ctx name f
                Nothing -> pure $ Function (Product [] ctx) (Product [] ctx) ctx [] [] False
            Nothing -> pickType' ctx <$> traverse recurse (c ^. parents)
    recurse parentName = do
      cc <- asks codeCollection
      case M.lookup parentName $ cc ^. contracts of
        Nothing -> pure . bottom $ "Could not find parent contract " <> T.pack parentName <$ ctx
        Just c' -> local (\r -> r {contract = c'}) go

getVarTypeByName' :: SolidString -> SourceAnnotation Text -> SSS Type'
getVarTypeByName' name ctx = do
  mVar <- foldr (lookupVar . snd) Nothing <$> get
  case mVar of
    Just BlankEntry -> error "getVarTypeByName' BlankEntry: I don't think this can happen"
    Just VarDefEntry {..} -> case vardefType of
      Just t -> pure $ Static t ctx
      Nothing -> pure $ Top (S.singleton name) ctx
    Nothing -> do
      c <- asks contract
      cc <- asks codeCollection
      let mVarDecl = ((_varType &&& const ctx) <$> M.lookup name (_storageDefs c))
              <|> ((_constType &&& const ctx) <$> M.lookup name (_constants c))
              <|> ((_constType &&& const ctx) <$> M.lookup name (_flConstants cc))
              <|> (const (SVMType.Enum Nothing name Nothing, ctx) <$> M.lookup name (_enums c))
              <|> (const (SVMType.Enum Nothing name Nothing, ctx) <$> M.lookup name (_flEnums cc))
              <|> (const (SVMType.Struct Nothing name, ctx) <$> M.lookup name (_flStructs cc))
              <|> (const (SVMType.Struct Nothing name, ctx) <$> M.lookup name (_structs c))
              <|> (const (SVMType.Error Nothing name, ctx) <$> M.lookup name (_errors c))
              <|> (const (SVMType.Error Nothing name, ctx) <$> M.lookup name (_flErrors cc))
      case mVarDecl of
        Just (e@(SVMType.Enum {}), ctx') ->
          pure . Sum $
            (Static e ctx')
              :| [ Function (Static e ctx') (Static e ctx') ctx' [] [] False,
                   Function (intType' ctx') (Static e ctx') ctx' [] [] False
                 ]
        Just (s@(SVMType.Struct _ struct), ctx') -> do
          fields <- fmap snd <$> lookupStruct struct
          let fArgs = flip Product ctx $ flip Static ctx <$> fields
          pure . Sum $
            (Static s ctx')
              :| [ Function fArgs (Static s ctx') ctx' [] [] False
                 ]
        Just (e@(SVMType.Error _ err), ctx') -> do
          args <- fmap snd <$> lookupError err
          let eArgs = flip Product ctx $ flip Static ctx <$> args
          pure . Sum $
            (Static e ctx')
              :| [ Function eArgs (Static e ctx') ctx' [] [] False
                 ]
        Just (t, ctx') -> pure $ Static t ctx'
        Nothing ->
          getFunctionByNameRecursively name ctx >>= \case
            b@Bottom {} -> do
              case M.lookup name $ _contracts cc of
                Just Contract{_parents=ps} -> do
                  let ctrct = Static (SVMType.Contract name) ctx
                      lbl = Static (SVMType.UnknownLabel name Nothing) ctx
                      pContracts = (\p -> Static (SVMType.Contract p) ctx) <$> ps
                      pLabels = (\p -> Static (SVMType.UnknownLabel p Nothing) ctx) <$> ps
                      cs = M.keys . M.filter (elem name . _parents) $ _contracts cc
                      cContracts = (\p -> Static (SVMType.Contract p) ctx) <$> cs
                      cLabels = (\p -> Static (SVMType.UnknownLabel p Nothing) ctx) <$> cs
                  pure . Sum $
                        ctrct
                          :| [ Function
                                 (Sum (Static (SVMType.Account False) ctx :| [ctrct, lbl] ++ pContracts ++ pLabels ++ cContracts ++ cLabels))
                                 ctrct
                                 ctx
                                 []
                                 []
                                 False
                             ]
                Nothing -> pure $ do
                  case M.lookup name $ _flFuncs cc of
                    Just f -> functionType cc ctx name f
                    Nothing -> b
            t -> pure t
  where
    lookupVar m Nothing = M.lookup name m
    lookupVar _ t = t

ignoreTops :: Monad m => SourceAnnotation Text -> SolidString -> Type -> m Type'
ignoreTops ann _ _ = pure $ topType' ann

setVarType' :: SourceAnnotation Text -> SolidString -> Type -> SSS Type'
setVarType' ctx name ty = state setType'
  where
    setType' (m :| ms) = case M.lookup name $ snd m of
      Nothing -> case ms of
        [] -> (bottom $ ("Unknown variable: " <> labelToText name) <$ ctx, m :| [])
        (r : est) -> NE.cons m <$> setType' (r :| est)
      Just BlankEntry -> (bottom $ ("Variable listed as BlankEntry: " <> labelToText name) <$ ctx, m :| ms)
      Just t@VarDefEntry {..} -> case vardefType of
        Nothing ->
          let t' = t {vardefType = Just ty}
           in (Static ty ctx, (M.insert name t' <$> m) :| ms)
        Just ty' -> case typecheckStatic ty ty' of
          Right ty'' -> (Static ty'' ctx, m :| ms)
          Left e -> (bottom $ ("Variable " <> labelToText name <> " being updated with wrong type: " <> e) <$ ctx, m :| ms)

pushLocalVariable :: Annotated VarDefEntryF -> SSS ()
pushLocalVariable BlankEntry = pure ()
pushLocalVariable v@VarDefEntry {..} = modify $ \case
  (r, x) :| xs -> (r, M.insert vardefName v x) :| xs

pushLocalVariables :: [Annotated VarDefEntryF] -> SSS ()
pushLocalVariables = traverse_ pushLocalVariable

isSVMVersion :: String -> CodeCollectionF a -> Bool
isSVMVersion ver cc = resolvePragmaFeature' (_pragmas cc) "solidvm" ver

statementHelper :: Annotated StatementF -> SSS Type'
statementHelper (IfStatement cond thens mElse x) = do
  cs <- tcExpr cond
  ts <- statementsHelper' x thens
  es <- statementsHelper' x $ fromMaybe [] mElse
  pure $ reduceType' x [cs, ts, es]
statementHelper (TryCatchStatement tryStatmenets catchMap x) = do
  cc <- asks codeCollection
  cntrct <- asks contract
  let errorParams =
        concatMap
          ( \y -> case M.lookup y $ _errors cntrct of
              Just z -> pure z
              Nothing -> maybe [] pure (M.lookup y $ _flErrors cc)
          )
          $ M.keys catchMap
      zipped =
        zipWith
          (curry (\case (y, Just z) -> zip y z; _ -> error "errorParams and catchMap don't match"))
          errorParams
          (map (fst . snd) (M.toList catchMap))

      paramsToDefs :: [((String, IndexedType, a), String)] -> [Annotated VarDefEntryF]
      paramsToDefs [] = []
      paramsToDefs (((_, a, _), b) : xs) = (VarDefEntry (Just $ indexedTypeType a) Nothing b x) : (paramsToDefs xs)
      localVarDefs = concatMap paramsToDefs zipped

  pushLocalVariables localVarDefs
  ts <- statementsHelper' x tryStatmenets
  es <- statementsHelper' x (concatMap (snd . snd) (M.toList catchMap))
  pure $ reduceType' x [ts, es]
statementHelper (SolidityTryCatchStatement expr mtpl successStatements catchMap x) = do
  cs <- tcExpr expr

  let errValsToVarDefs :: [Maybe (String, SVMType.Type)] -> [Annotated VarDefEntryF]
      errValsToVarDefs [] = []
      errValsToVarDefs (Nothing : xs) = errValsToVarDefs xs
      errValsToVarDefs ((Just (name, ty)) : xs) = (VarDefEntry (Just ty) Nothing name x) : (errValsToVarDefs xs)
      successValsToVarDefs :: Maybe [(String, SVMType.Type)] -> [Annotated VarDefEntryF]
      successValsToVarDefs Nothing = []
      successValsToVarDefs (Just xs) = errValsToVarDefs $ map Just xs
  let localVarDefs = (errValsToVarDefs $ (map (fst . snd) (M.toList catchMap))) ++ successValsToVarDefs mtpl
  pushLocalVariables localVarDefs

  ts <- statementsHelper' x successStatements
  es <- statementsHelper' x (concatMap (snd . snd) (M.toList catchMap))
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
  cc <- asks codeCollection
  mf <- asks function
  if isSVMVersion "11.4" cc
    then do 
      fm <- asks modifier
      case (fm,mf) of
        (Nothing,Nothing) -> pure . bottom $ "Cannot use keyword 'return' outside of a function" <$ x
        (Nothing,Just f) -> do
          let fRets = flip Product x $ flip Static x . indexedTypeType . snd <$> _funcVals f
          t' <- fRets ~> maybe (pure $ Product [] x) tcExpr mExpr
          modify $ \((ret, locals) :| rest) -> case ret of
            Nothing -> (Just t', locals) :| rest
            Just (Sum _) -> (Just t', locals) :| rest
            _ -> (ret, locals) :| rest
          pure t'
        (Just _,Nothing) ->
          pure . bottom $ "Cannot use keyword 'return' inside of a modifier." <$ x       
        (Just _,Just _)  -> 
          pure . bottom $ "Cannot use keyword 'return' inside of a modifier." <$ x
    else
      case mf of 
        Nothing -> pure . bottom $ "Cannot use keyword 'return' inside of a modifier." <$ x
        Just f -> do
          let fRets = flip Product x $ flip Static x . indexedTypeType . snd <$> _funcVals f
          t' <- fRets ~> maybe (pure $ Product [] x) tcExpr mExpr
          modify $ \((ret, locals) :| rest) -> case ret of
            Nothing -> (Just t', locals) :| rest
            Just (Sum _) -> (Just t', locals) :| rest
            _ -> (ret, locals) :| rest
          pure t'

statementHelper (Throw e x) = do
  et <- tcExpr e
  pure $ reduceType' x [et]
statementHelper (ModifierExecutor x) = pure $ topType' x
statementHelper (EmitStatement eventName vals x) = do
  cc <- asks codeCollection
  if isSVMVersion "11.4" cc
    then do
      e <- tcExpr $ Variable x eventName
      a <- productType' x <$> traverse (tcExpr . snd) vals
      apply e a $ traverse fst vals
    else
      reduceType' x <$> traverse (tcExpr . snd) vals
statementHelper (RevertStatement mErrorName args x) = do
  cc <- asks codeCollection
  if isSVMVersion "11.4" cc
    then do
      e <- case mErrorName of
             Nothing -> pure $ sumType' (Function (Product [] x) (Product [] x) x [] [Nothing] False) (Function (Product [stringType' x] x) (Product [] x) x [] [Nothing] False)
             Just errorName -> tcExpr $ Variable x errorName
      a <- case args of
        OrderedArgs es -> productType' x <$> traverse tcExpr es
        NamedArgs es -> productType' x <$> traverse (tcExpr . snd) es
      case args of
        NamedArgs es -> apply e a $ Just (fst <$> es)
        _ -> apply e a Nothing
    else case args of
           NamedArgs vals -> reduceType' x <$> traverse (tcExpr . snd) vals
           OrderedArgs vals -> reduceType' x <$> traverse tcExpr vals
statementHelper (UncheckedStatement body x) =
  statementsHelper' x body
statementHelper (AssemblyStatement _ x) = pure $ topType' x
statementHelper (SimpleStatement stmt x) = simpleStatementHelper x stmt

simpleStatementHelper :: SourceAnnotation Text -> Annotated SimpleStatementF -> SSS Type'
simpleStatementHelper x (VariableDefinition vdefs mExpr) = do
  pushLocalVariables vdefs
  let ts' = foldr varDefsToType' (topType' x) vdefs
  mExpr' <- maybe (pure $ topType' x) tcExpr mExpr
  case (ts', mExpr') of
    ((Static a@(SVMType.Int _ _) _), (Static b@(SVMType.Decimal) _)) -> pure . bottom $
      "Type mismatch: "
        <> showType a
        <> " and "
        <> showType b
        <> " do not match." <$ x
    _ -> ts' ~> maybe (pure $ topType' x) tcExpr mExpr
simpleStatementHelper _ (ExpressionStatement expr) =
  tcExpr expr

checkIfImmuteOperationValid :: Annotated ExpressionF -> SSS Type'
checkIfImmuteOperationValid (Variable y a) = do
  lstImmutNames <- asks immutableValNames
  if null lstImmutNames
    then tcExpr (Variable y a)
    else do
      thisFuncName <- asks functName
      let namesOfImmutesOnly = map (\x -> fst x) lstImmutNames
      let notConstructAndImmuteAissgnedValue = ((fromMaybe "" thisFuncName) /= "constructor") && (a `elem` namesOfImmutesOnly)
      let constructorAndImmuteValueOverwritten = ((fromMaybe "" thisFuncName) == "constructor") && ((a, True) `elem` lstImmutNames)
      if notConstructAndImmuteAissgnedValue || constructorAndImmuteValueOverwritten
        then pure . bottom $ "Immutable assignment error at" <$ y
        else tcExpr (Variable y a)
checkIfImmuteOperationValid a = tcExpr a

tcExpr :: Annotated ExpressionF -> SSS Type'
tcExpr (Binary x "+" a b) = do
  typeOne <- tcExpr a
  typeTwo <- tcExpr b
  case ((typeOne, a), (typeTwo, b)) of
    (((Static (SVMType.Int _ _) _), (Variable _ _)), ((Static (SVMType.Decimal) _), _)) -> pure . bottom $ ("Cannot perform arithmetic with explicit 'decimal' and 'int' types") <$ x
    (((Static (SVMType.Decimal) _), _), ((Static (SVMType.Int _ _) _), (Variable _ _))) -> pure . bottom $ ("Cannot perform arithmetic with explicit 'decimal' and 'int' types") <$ x
    _ -> sumType (intType' x) (stringType' x) (decimalType' x) ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "-" a b) = do
  typeOne <- tcExpr a
  typeTwo <- tcExpr b
  case ((typeOne, a), (typeTwo, b)) of
    (((Static (SVMType.Int _ _) _), (Variable _ _)), ((Static (SVMType.Decimal) _), _)) -> pure . bottom $ ("Cannot perform arithmetic with explicit 'decimal' and 'int' types") <$ x
    (((Static (SVMType.Decimal) _), _), ((Static (SVMType.Int _ _) _), (Variable _ _))) -> pure . bottom $ ("Cannot perform arithmetic with explicit 'decimal' and 'int' types") <$ x
    _ -> sumType' (intType' x) (decimalType' x) ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "*" a b) = do
  typeOne <- tcExpr a
  typeTwo <- tcExpr b
  case ((typeOne, a), (typeTwo, b)) of
    (((Static (SVMType.Int _ _) _), (Variable _ _)), ((Static (SVMType.Decimal) _), _)) -> pure . bottom $ ("Cannot perform arithmetic with explicit 'decimal' and 'int' types") <$ x
    (((Static (SVMType.Decimal) _), _), ((Static (SVMType.Int _ _) _), (Variable _ _))) -> pure . bottom $ ("Cannot perform arithmetic with explicit 'decimal' and 'int' types") <$ x
    _ -> sumType' (intType' x) (decimalType' x) ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "/" a b) = do
  typeOne <- tcExpr a
  typeTwo <- tcExpr b
  case ((typeOne, a), (typeTwo, b)) of
    (((Static (SVMType.Int _ _) _), (Variable _ _)), ((Static (SVMType.Decimal) _), _)) -> pure . bottom $ ("Cannot perform arithmetic with explicit 'decimal' and 'int' types") <$ x
    (((Static (SVMType.Decimal) _), _), ((Static (SVMType.Int _ _) _), (Variable _ _))) -> pure . bottom $ ("Cannot perform arithmetic with explicit 'decimal' and 'int' types") <$ x
    _ -> sumType' (intType' x) (decimalType' x) ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "%" a b) = do
  typeOne <- tcExpr a
  typeTwo <- tcExpr b
  case ((typeOne, a), (typeTwo, b)) of
    -- Int % Decimal
    (((Static (SVMType.Int _ _) _), (Variable _ _)), ((Static (SVMType.Decimal) _), _)) ->
      pure . bottom $ ("Cannot perform arithmetic with explicit 'decimal' and 'int' types") <$ x
    -- Decimal % Int
    (((Static (SVMType.Decimal) _), _), ((Static (SVMType.Int _ _) _), (Variable _ _))) ->
      pure . bottom $ ("Cannot perform arithmetic with explicit 'decimal' and 'int' types") <$ x
    -- Default: Int % Int or Decimal % Decimal
    _ -> sumType' (intType' x) (decimalType' x) ~> tcExpr a <~> tcExpr b
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
tcExpr (Binary x ">>>" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x ">>>=" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x ">>=" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "<<=" a b) =
  intType' x ~> tcExpr a <~> tcExpr b
tcExpr (Binary x "+=" a b) = do
  a' <- tcExpr a
  b' <- tcExpr b
  case (a', b') of
    ((Static c@(SVMType.Int _ _) _), (Static d@(SVMType.Decimal) _)) ->  pure . bottom $
      "Type mismatch: "
        <> showType c
        <> " and "
        <> showType d
        <> " do not match." <$ x
    _ -> sumType (intType' x) (stringType' x) (decimalType' x) ~> (checkIfImmuteOperationValid a) <~> tcExpr b
tcExpr (Binary x "-=" a b) = do
  a' <- tcExpr a
  b' <- tcExpr b
  case (a', b') of
    ((Static c@(SVMType.Int _ _) _), (Static d@(SVMType.Decimal) _)) ->  pure . bottom $
      "Type mismatch: "
        <> showType c
        <> " and "
        <> showType d
        <> " do not match." <$ x
    _ -> sumType' (intType' x) (decimalType' x) ~> (checkIfImmuteOperationValid a) <~> tcExpr b
tcExpr (Binary x "*=" a b) = do
  a' <- tcExpr a
  b' <- tcExpr b
  case (a', b') of
    ((Static c@(SVMType.Int _ _) _), (Static d@(SVMType.Decimal) _)) ->  pure . bottom $
      "Type mismatch: "
        <> showType c
        <> " and "
        <> showType d
        <> " do not match." <$ x
    _ -> sumType' (intType' x) (decimalType' x) ~> (checkIfImmuteOperationValid a) <~> tcExpr b
tcExpr (Binary x "/=" a b) = do
  a' <- tcExpr a
  b' <- tcExpr b
  case (a', b') of
    ((Static c@(SVMType.Int _ _) _), (Static d@(SVMType.Decimal) _)) ->  pure . bottom $
      "Type mismatch: "
        <> showType c
        <> " and "
        <> showType d
        <> " do not match." <$ x
    _ -> sumType' (intType' x) (decimalType' x) ~> (checkIfImmuteOperationValid a) <~> tcExpr b
tcExpr (Binary x "%=" a b) = do
  a' <- tcExpr a
  b' <- tcExpr b
  case (a', b') of
    ((Static c@(SVMType.Int _ _) _), (Static d@(SVMType.Decimal) _)) ->  pure . bottom $
      "Type mismatch: "
        <> showType c
        <> " and "
        <> showType d
        <> " do not match." <$ x
    _ -> sumType' (intType' x) (decimalType' x) ~> (checkIfImmuteOperationValid a) <~> tcExpr b
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
  sumType' (intType' x) (decimalType' x) ~> tcExpr a <~> tcExpr b !> pure (boolType' x)
tcExpr (Binary x ">" a b) =
  sumType' (intType' x) (decimalType' x) ~> tcExpr a <~> tcExpr b !> pure (boolType' x)
tcExpr (Binary x ">=" a b) =
  sumType' (intType' x) (decimalType' x) ~> tcExpr a <~> tcExpr b !> pure (boolType' x)
tcExpr (Binary x "<=" a b) =
  sumType' (intType' x) (decimalType' x) ~> tcExpr a <~> tcExpr b !> pure (boolType' x)
tcExpr (Binary x "=" a b) = do
  a' <- tcExpr a
  b' <- tcExpr b
  case (a', b') of
    ((Static c@(SVMType.Int _ _) _), (Static d@(SVMType.Decimal) _)) ->  pure . bottom $
      "Type mismatch: "
        <> showType c
        <> " and "
        <> showType d
        <> " do not match." <$ x
    _ -> (checkIfImmuteOperationValid a) <~> tcExpr b
tcExpr (Binary _ _ a b) =
  (tcExpr a <~> tcExpr b)
tcExpr (PlusPlus x a) =
  intType' x ~> tcExpr a
tcExpr (MinusMinus x a) = do
  intType' x ~> tcExpr a
tcExpr (NewExpression x b@SVMType.Bytes {}) = pure $ Static b x
tcExpr (NewExpression x a@SVMType.Array {}) = pure $ Static a x
tcExpr (NewExpression x (SVMType.UnknownLabel l _)) = getConstructorType' x l
tcExpr (NewExpression x (SVMType.Contract l)) = getConstructorType' x l
tcExpr (NewExpression x t) = pure . bottom $ ("Cannot use keyword 'new' in conjuction with type " <> showType t) <$ x
tcExpr (IndexAccess _ a (Just b)) = do
  a' <- tcExpr a
  b' <- tcExpr b
  typecheckIndex a' b'
tcExpr (IndexAccess _ a Nothing) = tcExpr a
tcExpr (MemberAccess _ a fieldName) = do
  t <- tcExpr a
  typecheckMember t fieldName
tcExpr (FunctionCall x (MemberAccess g (Variable wow nam) "wrap") args) = do
  -- This is a special check for user defined types
  c <- asks contract
  if M.member nam (_userDefined c) && (case args of OrderedArgs es -> length es == 1; _ -> False) -- If this var is a userDefined and only has one arguemnet, otherwise do usualy fuction handleing with MemeberAccess
    then do
      case args of
        OrderedArgs es -> do
          let check = case M.lookup nam (_userDefined c) of
                Just "uint" -> intType' x ~> tcExpr (head es)
                Just "int" -> intType' x ~> tcExpr (head es)
                Just "string" -> stringType' x ~> tcExpr (head es)
                Just "bool" -> boolType' x ~> tcExpr (head es)
                Just "bytes" -> bytesType' x ~> tcExpr (head es)
                _ -> pure . bottom $ "type not supported for user defined types" <$ x
          let actualTypeOfUserDefinedVar = userTypeHelper' $ M.lookup nam (_userDefined c)
          check !> (pure $ (Static (SVMType.UserDefined nam actualTypeOfUserDefinedVar) x))
        _ -> pure . bottom $ "named arguements not allowed in user defined wrap function" <$ x
    else do
      e <- tcExpr (MemberAccess g (Variable wow nam) "wrap")
      a <- case args of
        OrderedArgs es -> productType' x <$> traverse tcExpr es
        NamedArgs es -> productType' x <$> traverse (tcExpr . snd) es
      case args of
        NamedArgs es -> apply e a $ Just (fst <$> es)
        _ -> apply e a Nothing
tcExpr (FunctionCall x (MemberAccess g (Variable wow nam) "unwrap") args) = do
  -- Special function to catch user defined types using unwrap
  c <- asks contract
  if (M.member nam $ _userDefined c) && (case args of OrderedArgs es -> length es == 1; _ -> False)
    then do
      case args of
        OrderedArgs es -> do
          expressionResult <- tcExpr (head es)
          let actualTypeOfUserDefinedVar = userTypeHelper' $ M.lookup nam (_userDefined c)
          let check =
                ( case expressionResult of
                    (Static (SVMType.UserDefined name actual) _) -> pure $ checkerUserDefinedGetType (SVMType.UserDefined name actual) nam x
                    (Product [(Static (SVMType.UserDefined name actual) _)] _) -> pure $ checkerUserDefinedGetType (SVMType.UserDefined name actual) nam x
                    _ -> pure . bottom $ "Passing a non user defined type inside unwrap function of user defined type" <$ x
                )
          check !> (pure $ (Static (actualTypeOfUserDefinedVar) x))
        _ -> pure . bottom $ "Cannot use object literals within contract definitions" <$ x
    else do
      --Case of not user defines, for other functions that define a wrap and unwrap
      e <- tcExpr (MemberAccess g (Variable wow nam) "unwrap")
      a <- case args of
        OrderedArgs es -> productType' x <$> traverse tcExpr es
        NamedArgs es -> productType' x <$> traverse (tcExpr . snd) es
      case args of
        NamedArgs es -> apply e a $ Just (fst <$> es)
        _ -> apply e a Nothing
  where
    checkerUserDefinedGetType :: Type -> SolidString -> SourceAnnotation Text -> Type'
    checkerUserDefinedGetType (SVMType.UserDefined nameOfVar actuall) namm spot =
      if namm == nameOfVar
        then case actuall of
          (SVMType.Int _ _) -> (intType' spot)
          (SVMType.String _) -> (stringType' spot)
          SVMType.Bool -> (boolType' spot)
          (SVMType.Bytes _ _) -> (bytesType' spot)
          _ -> bottom $ "Not supported for casting such type to user defined type" <$ spot
        else bottom $ "Wrong User defined type" <$ spot
    checkerUserDefinedGetType _ _ spot = bottom $ "Wrong User defined type" <$ spot
tcExpr (FunctionCall x (Variable _ "type") args) =
  pure $ case args of
    (OrderedArgs _) -> Static (SVMType.UnknownLabel "type" Nothing) x
    _ -> bottom $ "Improper use of type function" <$ x
tcExpr (FunctionCall x (MemberAccess _ var "delegatecall") args) = do
  res <- sumType' (accountType' x) (addressType' x) ~> tcExpr var
  case (args, res) of
    (_, Bottom _) -> pure $ bottom $ "Can only use .delegatecall() as a method on an account or address" <$ x
    (OrderedArgs [], _) -> pure $ bottom $ ".delegatecall() requires at least one argument" <$ x
    (OrderedArgs (a : _), _) -> (stringType' x) ~> tcExpr a !> (pure $ topType' x)
    _ -> pure $ bottom $ ".delegatecall() does not take named arguements" <$ x
tcExpr (FunctionCall x (MemberAccess _ var "call") args) = do
  res <- sumType' (accountType' x) (addressType' x) ~> tcExpr var
  case (args, res) of
    (_, Bottom _) -> pure $ bottom $ "Can only use .call() as a method on an account or address" <$ x
    (OrderedArgs [], _) -> pure $ bottom $ ".call() requires at least one argument" <$ x
    (OrderedArgs (a : _), _) -> (stringType' x) ~> tcExpr a !> (pure $ topType' x)
    _ -> pure $ bottom $ ".call() does not take named arguments" <$ x
tcExpr (FunctionCall x (MemberAccess _ var "derive") args) = do
  res <- sumType' (accountType' x) (addressType' x) ~> tcExpr var
  case (args, res) of
    (_, Bottom _) -> pure $ bottom $ "Can only use derive() as a method on an account or address" <$ x
    (OrderedArgs [], _) -> pure $ bottom $ "derive() requires at least one argument" <$ x
    (OrderedArgs (a : _), _) -> (stringType' x) ~> tcExpr a !> (pure $ topType' x)
    _ -> pure $ bottom $ "derive() does not take named arguments" <$ x
tcExpr (FunctionCall x (MemberAccess _ var "truncate") args) = do
  res <- decimalType' x ~> tcExpr var
  case (args, res) of
    (_, Bottom _) -> pure $ bottom $ "Can only use truncate() as a method on a decimal number" <$ x
    (OrderedArgs [], _) -> pure $ bottom $ "truncate() requires at least one argument" <$ x
    (OrderedArgs [a], _) -> (intType' x) ~> tcExpr a !> (pure $ topType' x)
    (OrderedArgs (_ : _), _) -> pure $ bottom $ "truncate() only takes one argument" <$ x
    _ -> pure $ bottom $ "truncate() does not take named arguments" <$ x
tcExpr (FunctionCall x expr args) = do
  e <- tcExpr expr
  a <- case args of
    OrderedArgs es -> productType' x <$> traverse tcExpr es
    NamedArgs es -> productType' x <$> traverse (tcExpr . snd) es
  case args of
    NamedArgs es -> apply e a $ Just (fst <$> es)
    _ -> apply e a Nothing
tcExpr (Unitary x "-" a) = sumType' (intType' x) (decimalType' x) ~> tcExpr a
tcExpr (Unitary x "++" a) = intType' x ~> tcExpr a
tcExpr (Unitary x "--" a) = intType' x ~> tcExpr a
tcExpr (Unitary x "!" a) = boolType' x ~> tcExpr a
tcExpr (Unitary x "delete" a) = tcExpr a !> pure (Product [] x)
tcExpr (Unitary _ _ a) = tcExpr a
tcExpr (Ternary x a b c) =
  boolType' x ~> tcExpr a !> tcExpr b <~> tcExpr c
tcExpr (BoolLiteral x _) = pure $ boolType' x
tcExpr (NumberLiteral x _ _) = pure $ intType' x
tcExpr (DecimalLiteral x _) = pure $ decimalType' x
tcExpr (StringLiteral x _) = pure $ stringType' x
tcExpr (AccountLiteral x _) = pure $ accountType' x
tcExpr (HexaLiteral x _) = pure $ stringType' x
tcExpr (TupleExpression x es) =
  productType' x <$> traverse (maybe (pure $ topType' x) tcExpr) es
tcExpr (ArrayExpression x es) = do
  t' <- foldr (<~>) (pure $ topType' x) $ tcExpr <$> es
  pure $ case t' of
    (Static t _) -> Static (SVMType.Array t Nothing) x
    _ -> t'
tcExpr (Variable x name) = getVarType' (labelToString name) x
tcExpr (ObjectLiteral x _) = pure . bottom $ "Cannot use object literals within contract definitions" <$ x
