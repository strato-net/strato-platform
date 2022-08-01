{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
module SolidVM.Solidity.StaticAnalysis.Typechecker
  ( detector
  ) where

-- import           Blockchain.SolidVM.Exception
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
import           SolidVM.Model.CodeCollection
import qualified SolidVM.Model.CodeCollection.Contract as Con
import           SolidVM.Solidity.StaticAnalysis.Types
import           SolidVM.Model.SolidString
import           SolidVM.Model.Type (Type)
import qualified SolidVM.Model.Type as SVMType
import           Text.Read (readMaybe)
--import qualified Text.Colors                          as C
--import           Control.Monad.IO.Class

emptyAnnotation :: SourceAnnotation Text
emptyAnnotation = (SourceAnnotation (initialPosition "") (initialPosition "") "")

data R = R
  { codeCollection :: Annotated CodeCollectionF
  , contract :: Annotated ContractF
  , function :: Maybe (Annotated FuncF)
  , functName :: String
  , immutableValNames :: [(String, Bool)]
  }
type SSS = StateT (NonEmpty (Maybe Type', M.Map SolidString (Annotated VarDefEntryF))) (Reader R)

data TypeF' a = Top { topName :: (S.Set SolidString)
                    , topContext :: a
                    }
              | Bottom (NonEmpty a)
              | Static { staticType :: Type
                       , staticContext :: a
                       }
              | Product { productTypes :: [TypeF' a]
                        , productContext :: a
                        }
              | MultiVariate { multiVariateType :: (TypeF' a)
                             , multiVariateContext :: a
                             }
              | Sum { sumTypes :: NonEmpty (TypeF' a)
                    }
              | Function { functionArgType :: TypeF' a
                         , functionReturnType :: TypeF' a
                         , functionContext :: a
                         , functionOverloads :: [TypeF' a]
                         }
  deriving (Eq, Show, Functor)

type Type' = Annotated TypeF'

showType :: Type -> Text
showType (SVMType.Int s b) = (if fromMaybe False s then "u" else "")
                  <> "int"
                  <> (maybe "" (T.pack . show) b)
showType (SVMType.String _) = "string"
showType (SVMType.Bytes _ b) = "bytes"
                    <> (maybe "" (T.pack . show) b)
showType (SVMType.Fixed s b) = (if fromMaybe False s then "u" else "")
                  <> "fixed"
                  <> maybe "" (T.pack . show) b
showType SVMType.Bool = "bool"
showType (SVMType.Address _) = "address"
showType (SVMType.Account _) = "account"
showType (SVMType.UnknownLabel s _) = "label " <> labelToText s
showType (SVMType.Struct _ n) = "struct " <> labelToText n
showType (SVMType.Enum _ n _) = "enum " <> labelToText n
showType (SVMType.Array t l) = T.concat
                     [ showType t
                     , "["
                     , maybe "" (T.pack . show) l
                     , "]"
                     ]
showType (SVMType.Contract n) = "contract " <> labelToText n
showType (SVMType.Mapping _ k v) = "mapping (" <> showType k <> " => " <> showType v <> ")"

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
showType' (Function a (Product [] _) _ _) =
  T.concat [ "function "
           , showType' a
           ]
showType' (Function a r _ _) =
  T.concat [ "function ("
           , showType' a
           , " returns "
           , showType' r
           ]
showType' (MultiVariate a _) = T.concat
                              [ "("
                              , showType' a
                              , ")"
                              ]

varDefsToType' :: Annotated VarDefEntryF -> Type' -> Type'
varDefsToType' BlankEntry t                   = Product [topType' (context' t), t] (context' t)
varDefsToType' VarDefEntry{..} t | vardefType == Nothing = t
varDefsToType' VarDefEntry{..} (Top _ _)      = Static (fromJust vardefType) vardefContext
varDefsToType' VarDefEntry{..} t@(Static _ _) = Product [Static (fromJust vardefType) vardefContext, t] vardefContext
varDefsToType' VarDefEntry{..} t@(Sum _)      = Product [Static (fromJust vardefType) vardefContext, t] vardefContext
varDefsToType' VarDefEntry{..} (Product ts _) = Product (Static (fromJust vardefType) vardefContext : ts) vardefContext
varDefsToType' VarDefEntry{} (Bottom es)    = Bottom es
varDefsToType' VarDefEntry{..} _              = bottom $ "Could not match variable definition with function type" <$ vardefContext

lookupEnum :: SolidString -> SSS [SolidString]
lookupEnum name = do
  c <- asks contract
  pure . maybe [] fst $ M.lookup name (_enums c)

lookupStruct :: SolidString -> SSS [(SolidString, Type)]
lookupStruct name = do
  c <- asks contract
  let str = fromMaybe [] $ M.lookup name (_structs c)
  pure $ f <$> str
  where f (t, ft, _) = (t, fieldTypeType ft)

lookupContractFunction :: SourceAnnotation Text -> SolidString -> SolidString -> SSS Type'
lookupContractFunction x cName fName = do
  --liftIO $ putStrLn $ C.green ("lookupContractFunction " ++ (show cName) ++ " " ++ (show fName))
  ~CodeCollection{..} <- asks codeCollection
  case M.lookup cName _contracts of
    Nothing -> pure . bottom $ ("Unknown contract: " <> labelToText cName) <$ x
    Just c -> case M.lookup fName (_functions c) of
      Nothing -> case M.lookup fName (_constants c) of
        Nothing -> case M.lookup fName (_storageDefs c) of
          Nothing -> pure . bottom $ (T.concat
            [ "Unknown contract function: "
            , labelToText cName
            , "."
            , labelToText fName
            ]) <$ x
          Just VariableDecl{..} ->
            if varIsPublic
              then pure $ Function (Product [] x) (Static varType x) x []
              else pure . bottom $ (T.concat
                [ "Contract variable "
                , labelToText cName
                , "."
                , labelToText fName
                , " is not public."
                ]) <$ x
        Just ConstantDecl{..} -> pure $ Static constType x
      Just Func{..} -> case funcVisibility of
        Just v | v == Internal || v == Private -> pure . bottom $ (T.concat
          [ "Function "
          , labelToText cName
          , "."
          , labelToText fName
          , " has visibility of "
          , T.pack $ show v
          , " so it cannot be called externally."
          ]) <$ x
        _ -> let fArgs = flip Product x $ flip Static x . indexedTypeType . snd <$> funcArgs
                 fRets = flip Product x $ flip Static x . indexedTypeType . snd <$> funcVals
              in pure $ Function fArgs fRets x []

productType' :: SourceAnnotation Text -> [Type'] -> Type'
productType' _ [Bottom es] = Bottom es
productType' _ [t] = t
productType' x ts = case reduceType' x ts of
  Bottom es -> Bottom es
  _ -> Product ts x

apply' :: Type' -> Type' -> [Type'] -> Type' -> SSS Type'
apply' argTypes valTypes overloads args = do
  p <- typecheck argTypes args
  case (p, valTypes) of
    (Bottom es, Bottom ess) -> pure $ Bottom (es <> ess)
    (Bottom es, _) -> case overloads of
                        [] -> pure $ Bottom es
                        (x:xs) -> apply' (functionArgType x) (functionReturnType x) xs args
    _ -> pure $ valTypes

apply :: Type' -> Type' -> SSS Type'
apply (Bottom es) (Bottom ess) = pure $ Bottom (es <> ess)
apply (Bottom es) _            = pure $ Bottom es
apply _ (Bottom ess)           = pure $ Bottom ess
apply (Function argTypes valTypes _ overloads) args = apply' argTypes valTypes overloads args
apply (Sum types@(t :| _)) args =
  let isFunction (Function _ _ _ _) = True
      isFunction _ = False
   in pickType' (context' t) <$> traverse (flip apply args) (filter isFunction $ NE.toList types)
apply x _ = pure . bottom $ "trying to apply function to a non-function type" <$ context' x

bottom :: a -> TypeF' a
bottom a = Bottom $ a :| []

intType' :: SourceAnnotation Text -> Type'
intType' = Static (SVMType.Int Nothing Nothing)

stringType' :: SourceAnnotation Text -> Type'
stringType' = Static (SVMType.String Nothing)

-- bytesType' :: SourceAnnotation Text -> Type'
-- bytesType' = Static (SVMType.Bytes Nothing Nothing)

boolType' :: SourceAnnotation Text -> Type'
boolType' = Static SVMType.Bool

addressType' :: SourceAnnotation Text -> Type'
addressType' = Static $ SVMType.Address False

--AddressPayableType' :: SourceAnnotation Text -> Type'
--AddressPayableType' = Static $ SVMType.Address True


accountType' :: SourceAnnotation Text -> Type'
accountType' = Static $ SVMType.Account False

--accountPayableType' :: SourceAnnotation Text -> Type'
--accountPayableType' = Static $ SVMType.Account True

enumType' :: SourceAnnotation Text -> Type'
enumType' = Static (SVMType.Enum Nothing "" Nothing)

-- structType' :: SourceAnnotation Text -> Type'
-- structType' = Static (Struct Nothing "")

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
context' MultiVariate{..}  = multiVariateContext


typecheck' :: Monad m => (SourceAnnotation Text -> SolidString -> Type -> m Type') -> Type' -> Type' -> m Type'
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
  (MultiVariate a _, MultiVariate b _) -> typecheck' f a b
  (MultiVariate a _, Product xs x) -> typecheckProduct f x xs (replicate (length xs) a)
  (Product xs x, MultiVariate a _) -> typecheckProduct f x xs (replicate (length xs) a)
  (MultiVariate a _, b) -> typecheck' f a b
  (a, MultiVariate b _) -> typecheck' f a b
  (Function a1 v1 x _, Function a2 v2 _ _) -> do
    a <- typecheck' f a1 a2
    v <- typecheck' f v1 v2
    pure $ case (a, v) of
      (Bottom es, Bottom ess) -> Bottom (es <> ess)
      (Bottom es, _) -> Bottom es
      (_, Bottom ess) -> Bottom ess
      _ -> Function a v x []
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

typecheckProduct :: Monad m => (SourceAnnotation Text -> SolidString -> Type -> m Type') -> SourceAnnotation Text -> [Type'] -> [Type'] -> m Type'
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
typecheckStatic (SVMType.Int s1 b1) (SVMType.Int s2 b2) =
  case (s1, s2) of
    (Just a, Just b) | a /= b -> Left "Mismatched signedness between integer values"
    _ -> case (b1, b2) of
           (Just a, Just b) | a /= b -> Left "Mismatched length between integer values"
           _ -> Right $ SVMType.Int (s1 <|> s2) (b1 <|> b2)
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
typecheckStatic (SVMType.Fixed s1 d1) (SVMType.Fixed s2 d2) =
  case(s1, s2) of
    (Just a, Just b) | a /= b -> Left "Mismatched dynamicity between fixed-point values"
    _ -> case(d1, d2) of
      (Just a, Just b) | a /= b -> Left "Mismatched dynamicity between fixed-point values"
      _ ->  Right $ SVMType.Fixed (s1 <|> s2) (d1 <|> d2)
typecheckStatic SVMType.Bool SVMType.Bool = Right SVMType.Bool
typecheckStatic (SVMType.Address a) (SVMType.Address b) = Right $ SVMType.Account (a && b)
typecheckStatic (SVMType.Address a) (SVMType.Account b) = Right $ SVMType.Account (a && b)
typecheckStatic (SVMType.Account a) (SVMType.Address b) = Right $ SVMType.Account (a && b)
typecheckStatic (SVMType.Account a) (SVMType.Account b) = Right $ SVMType.Account (a && b)
typecheckStatic (SVMType.UnknownLabel a _) (SVMType.UnknownLabel b _) =
  if a == b || a == "" || b == ""
    then Right (SVMType.UnknownLabel (string' [a, b]) Nothing)
    else Left $ "Type mismatch: labels "
             <> labelToText a
             <> " and "
             <> labelToText b
             <> " do not match."
typecheckStatic (SVMType.UnknownLabel a _) b@SVMType.Struct{} =
  typecheckStatic (SVMType.Struct Nothing a) b
typecheckStatic a@SVMType.Struct{} (SVMType.UnknownLabel b _) =
  typecheckStatic a (SVMType.Struct Nothing b)
typecheckStatic (SVMType.Struct b1 t1) (SVMType.Struct b2 t2) =
  case (b1, b2) of
    (Just a, Just b) | a /= b -> Left "Mismatched byte sizes between struct types"
    _ ->
      if t1 == t2 || t1 == "" || t2 == ""
        then Right $ SVMType.Struct (b1 <|> b2) (string' [t1, t2])
        else Left $ "Type mismatch between struct values: "
                 <> labelToText t1
                 <> " and "
                 <> labelToText t2
                 <> " do not match."
typecheckStatic (SVMType.UnknownLabel a _) b@SVMType.Enum{} =
  typecheckStatic (SVMType.Enum Nothing a Nothing) b
typecheckStatic a@SVMType.Enum{} (SVMType.UnknownLabel b _) =
  typecheckStatic a (SVMType.Enum Nothing b Nothing)
typecheckStatic (SVMType.Enum b1 t1 n1) (SVMType.Enum b2 t2 n2) =
  case (b1, b2) of
    (Just a, Just b) | a /= b -> Left "Mismatched byte sizes between enum types"
    _ -> case (n1, n2) of
           (Just a, Just b) | a /= b -> Left "Mismatched names between enum types"
           _ -> if t1 == t2 || t1 == "" || t2 == ""
                  then Right $ SVMType.Enum (b1 <|> b2) (string' [t1, t2]) (n1 <|> n2)
                  else Left $ "Type mismatch between enum values: "
                           <> labelToText t1
                           <> " and "
                           <> labelToText t2
                           <> " do not match."
typecheckStatic (SVMType.Array t1 l1) (SVMType.Array t2 l2) = do
  e <- typecheckStatic t1 t2
  case (l1, l2) of
    (Just a, Just b) | a /= b -> Left "Mismatched length between array values"
    _ -> Right $ SVMType.Array e (l1 <|> l2)
typecheckStatic (SVMType.UnknownLabel a _) b@SVMType.Contract{} =
  typecheckStatic (SVMType.Contract a) b
typecheckStatic a@SVMType.Contract{} (SVMType.UnknownLabel b _) =
  typecheckStatic a (SVMType.Contract b)
typecheckStatic (SVMType.Contract a) (SVMType.Contract b) =
  if a == b || a == "" || b == ""
    then Right (SVMType.Contract $ string' [a, b])
    else Left $ "Type mismatch: contracts "
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
typecheckStatic theType (SVMType.Bytes _ _) = Right theType
typecheckStatic t1 t2 = Left $ "Type mismatch: "
                            <> showType t1
                            <> " and "
                            <> showType t2
                            <> " do not match."

typecheckIndex :: Type' -> Type' -> SSS Type'
typecheckIndex (Bottom es) (Bottom ess) = pure $ Bottom (es <> ess)
typecheckIndex (Bottom es) _ = pure $ Bottom es
typecheckIndex _ (Bottom es) = pure $ Bottom es
typecheckIndex (Static (SVMType.Array t _) x) i = i ~> (pure $ intType' x) !> pure (Static t x)
typecheckIndex (Static (SVMType.Bytes _ _) x) i = i ~> (pure $ intType' x) !> pure (Static (SVMType.Bytes Nothing (Just 1)) x)
typecheckIndex (Static (SVMType.Mapping _ k v) x) i = do
  t <- typecheck (Static k x) i
  pure $ case t of
    Bottom es -> Bottom es
    _ -> Static v x
typecheckIndex x y = pure . bottom $
  (T.concat
  [ "Mismatched index type: trying to lookup index of type "
  , showType' y
  , " from type "
  , showType' x
  , "."
  ]) <$ (context' x <> context' y)

typecheckMember :: Type' -> SolidString -> SSS Type'
typecheckMember (Bottom es) _ = pure $ Bottom es
typecheckMember (Sum ts'@(t :| _)) n = pickType' (context' t) <$> traverse (flip typecheckMember n) (NE.toList ts')
typecheckMember (Static (SVMType.Array _ _) x) "length" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.Array t _) x) "push" = pure $ Function (Static t x) (Product [] x) x []
typecheckMember (Static (SVMType.Array _ _) x) n = pure . bottom $ ("Unknown member of SVMType.Array: " <> labelToText n) <$ x
typecheckMember (Static (SVMType.Bytes _ _) x) "length" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.UnknownLabel "Util" Nothing) x) "bytes32ToString" = pure $ Function (Static (SVMType.Bytes Nothing (Just 32)) x) (Static (SVMType.String Nothing) x) x []
typecheckMember (Static (SVMType.UnknownLabel "Util" Nothing) x) "b32" = pure $ Function (Static (SVMType.Bytes Nothing (Just 32)) x) (Static (SVMType.Bytes Nothing (Just 32)) x) x []
typecheckMember (Static (SVMType.UnknownLabel "string" Nothing) x) "concat" = pure $ Function (stringConcatArgs x) (Static (SVMType.String Nothing) x) x []
typecheckMember (Static (SVMType.UnknownLabel "msg" Nothing) x) "sender" = pure $ Static (SVMType.Account False) x 
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
typecheckMember (Static (SVMType.UnknownLabel "super" Nothing) x) method = do
  ctract <- asks contract
  cc <- asks codeCollection
  case getParents ((fmap $ const ()) <$> cc) ((fmap $ const ()) <$> ctract) of
    Left _ -> pure . bottom $ "Contract has missing parents" <$ x
    Right parents' -> case filter (elem method . M.keys .  _functions) parents' of
      [] -> pure . bottom $ "cannot use super without a parent contract" <$ x
      ps -> case M.lookup method . _functions $ last ps of
        Nothing -> pure . bottom $ ("super does not have a function called " <> labelToText method) <$ x
        Just Func{..} ->
          let fArgs = flip Product x $ flip Static x . indexedTypeType . snd <$> funcArgs
              fRets = flip Product x $ flip Static x . indexedTypeType . snd <$> funcVals
           in pure $ Function fArgs fRets x []
typecheckMember (Static e@(SVMType.Enum _ enum mNames) x) n = do
  names <- case mNames of
    Just names -> pure names
    Nothing -> lookupEnum enum
  pure $ if n `elem` names
           then Static e x
           else bottom $ (T.concat
             [ "Missing enum element: "
             , labelToText n
             , " is not an element of "
             , labelToText enum
             ]) <$ x

-- Function: argType, returnType, contextType
-- Static: argType, ContextType
typecheckMember (Static (SVMType.Account True ) x) "transfer" = pure $ Function (Static (SVMType.Int Nothing Nothing) x) (Product [] x) x []
typecheckMember (Static (SVMType.Account True ) x) "send" = pure $ Function (Static (SVMType.Int Nothing Nothing) x) (Static (SVMType.Bool) x) x []
typecheckMember (Static (SVMType.Account _) x) "balance" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.Account _) x) "code" = pure $ Static (SVMType.Bytes Nothing Nothing) x
typecheckMember (Static (SVMType.Account _) x) "codehash" = pure $ Static (SVMType.String Nothing) x
typecheckMember (Static (SVMType.Account _) x) "chainId" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.Struct _ struct) x) n = do
  names <- M.fromList <$> lookupStruct struct
  pure $ case M.lookup n names of
    Just t -> Static t x
    Nothing -> bottom $ (T.concat
      [ "Missing struct element: "
      , labelToText n
      , " is not a field of "
      , labelToText struct
      ]) <$ x
-- I'm intentionally leaving out send and transfer for Contract types, since we don't have a payable flag for them yet
typecheckMember (Static (SVMType.Contract _) x) "balance" = pure $ Static (SVMType.Int Nothing Nothing) x
typecheckMember (Static (SVMType.Contract _) x) "code" = pure $ Static (SVMType.Bytes Nothing Nothing) x
typecheckMember (Static (SVMType.Contract _) x) "codehash" = pure $ Static (SVMType.String Nothing) x
typecheckMember (Static (SVMType.Contract _) x) "chainId" = pure $ Static (SVMType.Int Nothing Nothing) x
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
            Bottom _ -> pure . bottom $ (T.concat
              [ "Missing label: "
              , labelToText c
              , (T.pack (show f))
              , " is not a known enum, struct, or contract."
              ]) <$ x
            t -> pure t
        t -> pure t
    t -> pure t
typecheckMember x n = pure . bottom $ ("Unknown member: " <> showType' x <> "." <> labelToText n) <$ context' x

getConstructorType' :: MonadReader R m => SourceAnnotation Text -> SolidString -> m Type'
getConstructorType' x l  = do
  ~CodeCollection{..} <- asks codeCollection
  case M.lookup l _contracts of
    Nothing -> do
      --look through all the contracts get the _modifiers maps and check to see if l is a key in there
      
      let allModifierMap =  M.unions $ map ((Con._modifiers) . snd) (M.toList _contracts)
      case M.lookup l allModifierMap of
        Nothing -> pure . bottom $ ("Unknown Contract or Modifier: " <> labelToText l) <$ x
        Just _ -> pure $ Top (S.singleton l) x

    Just c -> case _constructor c of
      Nothing -> pure $ Function (Product [] x) (Static (SVMType.Contract l) x) x []
      Just Func{..} ->
        let fArgs = flip Product x $ flip Static x . indexedTypeType . snd <$> funcArgs
         in pure $ Function fArgs (Static (SVMType.Contract l) x) x []




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
      varTypes' = reduceType' (_contractContext c) $ varDeclHelper cc c <$> M.elems (_storageDefs c)
      constTypes' = reduceType' (_contractContext c) $ constDeclHelper cc c <$> M.elems (_constants c)
      funcTypes' = reduceType' (_contractContext c) $ uncurry (functionHelper cc c) <$> M.toList funcsAndConstr 
   in reduceType' (_contractContext c) [varTypes', constTypes', funcTypes']

varDeclHelper :: Annotated CodeCollectionF
              -> Annotated ContractF
              -> Annotated VariableDeclF
              -> Type'
varDeclHelper cc c VariableDecl{..} =
  let ty = Static varType varContext
   in case varInitialVal of
        Nothing -> ty
        Just e ->
          let r = R cc c Nothing "Nothing" []
           in runReader (evalStateT (ty ~> tcExpr e) ((Nothing, M.empty) :| [])) r

constDeclHelper :: Annotated CodeCollectionF
                -> Annotated ContractF
                -> Annotated ConstantDeclF
                -> Type'
constDeclHelper cc c ConstantDecl{..} =
  let ty = Static constType constContext
      r = R cc c Nothing "Nothing" []
   in runReader (evalStateT (ty ~> tcExpr constInitialVal) ((Nothing, M.empty) :| [])) r

functionHelper :: Annotated CodeCollectionF
               -> Annotated ContractF
               -> String 
               -> Annotated FuncF
               -> Type'
functionHelper cc c funcName f@Func{..} = case funcContents of
  Nothing -> Function (Product [] funcContext) (Product [] funcContext) funcContext []
  Just stmts ->
    if funcName == "receive"
      then case (funcArgs, funcVals, funcStateMutability, funcVisibility) of
        ([], [], Just Payable, Just External) -> let r = R cc c (Just f) funcName (map (\(nameOfVar, varDecl) -> (nameOfVar, Nothing /= varInitialVal varDecl) ) (filter (\(_, varDecl) ->  (isImmutable varDecl ) ) (M.toList $ _storageDefs c)))
                                                     swap = uncurry $ flip (,)
                                                     args = (\(it,n) -> ( n
                                                                        , VarDefEntry (Just $ indexedTypeType it) Nothing n funcContext
                                                                        ))
                                                        <$> (catMaybes $ sequence . swap <$> funcArgs)
                                                     vals = (\(it,n) -> ( n
                                                                        , VarDefEntry (Just $ indexedTypeType it) Nothing n funcContext
                                                                        ))
                                                        <$> (catMaybes $ sequence . swap <$> funcVals)
                                                     argVals = M.fromList $ args ++ vals
                                                  in runReader (statementsHelper argVals stmts) r
        ([fArg], _, _, _) -> bottom  $ (T.concat
                          [ "Function `receive` must take no arguments, but has been given "
                          , T.pack $ show fArg
                          ]) <$ funcContext
        (_, [fVal], _, _) -> bottom $ (T.concat
                          [ "Function `receive` must have no return values, but has been given "
                          , T.pack $ show fVal 
                          ]) <$ funcContext 
        _ -> bottom $ "Function `receive` must be External and Payable, but has not been declared so " <$ funcContext
    else if funcName == "fallback"
      then case (funcArgs, funcVals, funcVisibility) of 
        ([], [], Just External) -> let r = R cc c (Just f) funcName (map (\(nameOfVar, varDecl) -> (nameOfVar, Nothing /= varInitialVal varDecl) ) (filter (\(_, varDecl) ->  (isImmutable varDecl ) ) (M.toList $ _storageDefs c)))
                                       swap = uncurry $ flip (,)
                                       args = (\(it,n) -> ( n
                                                            , VarDefEntry (Just $ indexedTypeType it) Nothing n funcContext
                                                          ))
                                                        <$> (catMaybes $ sequence . swap <$> funcArgs)
                                       vals = (\(it,n) -> ( n
                                                            , VarDefEntry (Just $ indexedTypeType it) Nothing n funcContext
                                                           ))
                                                        <$> (catMaybes $ sequence . swap <$> funcVals)
                                       argVals = M.fromList $ args ++ vals
                                   in runReader (statementsHelper argVals stmts) r
        ([fArg], _, _) -> bottom  $ (T.concat
                          [ "Function `fallback` must take no arguments, but has been given "
                          , T.pack $ show fArg
                          ]) <$ funcContext
        (_, [fVal], _) -> bottom $ (T.concat
                          [ "Function `fallback` must have no return values, but has been given "
                          , T.pack $ show fVal 
                          ]) <$ funcContext 
        _ -> bottom $ "Function `fallback` must be External, but has not been declared so " <$ funcContext
      else
        let r = R cc c (Just f) funcName (map (\(nameOfVar, varDecl) -> (nameOfVar, Nothing /= varInitialVal varDecl) ) (filter (\(_, varDecl) ->  (isImmutable varDecl ) ) (M.toList $ _storageDefs c)))
            swap = uncurry $ flip (,)
            args = (\(it,n) -> ( n
                              , VarDefEntry (Just $ indexedTypeType it) Nothing n funcContext
                              ))
              <$> (catMaybes $ sequence . swap <$> funcArgs)
            vals = (\(it,n) -> ( n
                              , VarDefEntry (Just $ indexedTypeType it) Nothing n funcContext
                              ))
              <$> (catMaybes $ sequence . swap <$> funcVals)
            argVals = M.fromList $ args ++ vals
        in runReader (statementsHelper argVals stmts) r

statementsHelper :: (M.Map SolidString (Annotated VarDefEntryF))
                 -> [Annotated StatementF]
                 -> Reader R Type'
statementsHelper args ss = do
  mf <- asks function
  case mf of
    Nothing -> do
      x <- asks $ _contractContext . contract
      pure . bottom $ "Cannot use keyword 'return' outside of a function" <$ x
    Just f -> do
      let x = funcContext f
      ~(ts', s) <- flip runStateT ((Nothing, args) :| []) $ do
        cCalls <- for (M.assocs $ funcConstructorCalls f) $ \(cName, exprs) -> do
          let constructorArgs = getConstructorType' x cName 
              givenArgs = flip Product x <$> traverse tcExpr exprs
              givenFunc = (\t-> Function t (Static (SVMType.Contract cName) x) x []) <$> givenArgs
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
                    , Product [intType' x, stringType' x, intType' x] x
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
keccak256Args x = MultiVariate (stringType' x) x

sha256Args :: SourceAnnotation Text -> Type'
sha256Args x = MultiVariate (stringType' x) x

ripemd160Args :: SourceAnnotation Text -> Type'
ripemd160Args x = MultiVariate (stringType' x) x

--This function should have multivariate type that represents any amount of string types
stringConcatArgs :: SourceAnnotation Text -> Type'
stringConcatArgs x = MultiVariate (stringType' x) x

requireArgs :: SourceAnnotation Text -> Type'
requireArgs x = Sum $ boolType' x :|
                    [ Product [boolType' x, topType' x] x
                    ]

assertArgs :: SourceAnnotation Text -> Type'
assertArgs x = boolType' x

registerCertArgs :: SourceAnnotation Text -> Type'
registerCertArgs x = Sum $ stringType' x :| 
                        [ Product [stringType' x, contractType' x] x
                        , Product [accountType' x, stringType' x] x
                        ]

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

mulmodArgs  :: SourceAnnotation Text -> Type'
mulmodArgs x = Product [intType' x, intType' x, intType' x] x

blockhashArgs :: SourceAnnotation Text -> Type'
blockhashArgs x = intType' x

addmodArgs  :: SourceAnnotation Text -> Type'
addmodArgs x = Product [intType' x, intType' x, intType' x] x

payableArgs :: SourceAnnotation Text -> Type'
payableArgs x = accountType' x

parseCertArgs :: SourceAnnotation Text -> Type'
parseCertArgs x = stringType' x

getVarType' :: String -> SourceAnnotation Text -> SSS Type'
getVarType' "this" ctx = pure $ Static (SVMType.Account False) ctx
getVarType' s@('u':'i':'n':'t':n) ctx = case n of
  [] -> pure $ Function (intArgs ctx) (Static (SVMType.Int (Just False) Nothing) ctx) ctx []
  _ -> case readMaybe n of
    Just n' -> pure $ Function (intArgs ctx) (Static (SVMType.Int (Just False) (Just n')) ctx) ctx []
    Nothing -> getVarTypeByName' (stringToLabel s) ctx
getVarType' s@('i':'n':'t':n) ctx = case n of
  [] -> pure $ Function (intArgs ctx) (Static (SVMType.Int (Just True) Nothing) ctx) ctx []
  _ -> case readMaybe n of
    Just n' -> pure $ Function (intArgs ctx) (Static (SVMType.Int (Just True) (Just n')) ctx) ctx []
    Nothing -> getVarTypeByName' (stringToLabel s) ctx
getVarType' "address" ctx =  pure $ Function (addressArgs ctx) (Static (SVMType.Account False) ctx) ctx []
getVarType' "account" ctx =  pure $ Function (accountArgs ctx) (Static (SVMType.Account False) ctx) ctx []
--This is either the string() function or the string.member() function
getVarType' "string" ctx =  pure $ Sum $ (Function (stringArgs ctx) (stringType' ctx) ctx []) :| [Static (SVMType.UnknownLabel "string" Nothing) ctx]
getVarType' "bool" ctx =  pure $ Function (boolArgs ctx) (boolType' ctx) ctx []
getVarType' s@('b':'y':'t':'e':'s':n) ctx = case n of
  [] -> pure $ Function (byteArgs ctx) (Static (SVMType.Bytes Nothing Nothing) ctx) ctx []
  _ -> case readMaybe n of
    Just n' -> pure $ Function (byteArgs ctx) (Static (SVMType.Bytes Nothing (Just n')) ctx) ctx []
    Nothing -> getVarTypeByName' (stringToLabel s) ctx
getVarType' "byte" ctx =  pure $ Function (byteArgs ctx) (intType' ctx) ctx []
getVarType' "push" ctx =  pure $ Function (topType' ctx) (Product [] ctx) ctx []
getVarType' "identity" ctx =  pure $ Function (topType' ctx) (topType' ctx) ctx []
getVarType' "keccak256" ctx =  pure $ Function (keccak256Args ctx) (stringType' ctx) ctx []
getVarType' "sha256" ctx =  pure $ Function (sha256Args ctx) (stringType' ctx) ctx []
getVarType' "ripemd160" ctx =  pure $ Function (ripemd160Args ctx) (stringType' ctx) ctx []
getVarType' "selfdestruct" ctx = pure $ Function (selfdestructArgs ctx) (boolType' ctx) ctx  []
getVarType' "require" ctx =  pure $ Function (requireArgs ctx) (Product [] ctx) ctx []
getVarType' "assert" ctx =  pure $ Function (assertArgs ctx) (Product [] ctx) ctx []
getVarType' "registerCert" ctx =  pure $ Function (registerCertArgs ctx) (accountType' ctx) ctx []
getVarType' "verifyCert" ctx =  pure $ Function (verifyCertArgs ctx) (boolType' ctx) ctx []
getVarType' "verifyCertSignedBy" ctx =  pure $ Function (verifyCertSignedByArgs ctx) (boolType' ctx) ctx []
getVarType' "verifySignature" ctx =  pure $ Function (verifySignatureArgs ctx) (boolType' ctx) ctx []
getVarType' "getUserCert" ctx =  pure $ Function (getUserCertArgs ctx) (certType' ctx) ctx []
getVarType' "addmod" ctx =  pure $ Function (addmodArgs ctx) (intType' ctx) ctx []
getVarType' "mulmod" ctx =  pure $ Function (mulmodArgs ctx) (intType' ctx) ctx []
getVarType' "payable" ctx =  pure $ Function (payableArgs ctx) (Static (SVMType.Account True) ctx) ctx []
getVarType' "blockhash" ctx = pure $ Function (blockhashArgs ctx) (stringType' ctx) ctx []
getVarType' "parseCert" ctx =  pure $ Function (parseCertArgs ctx) (certType' ctx) ctx []
getVarType' "Util" ctx = pure $ Static (SVMType.UnknownLabel "Util" Nothing) ctx
getVarType' "msg" ctx = pure $ Static (SVMType.UnknownLabel "msg" Nothing) ctx
getVarType' "tx" ctx = pure $ Static (SVMType.UnknownLabel "tx" Nothing) ctx
getVarType' "block" ctx = pure $ Static (SVMType.UnknownLabel "block" Nothing) ctx
getVarType' "super" ctx = pure $ Static (SVMType.UnknownLabel "super" Nothing) ctx
getVarType' name ctx = getVarTypeByName' (stringToLabel name) ctx

getVarTypeByName' :: SolidString -> SourceAnnotation Text -> SSS Type'
getVarTypeByName' name ctx = do
  mVar <- foldr (lookupVar . snd) Nothing <$> get
  case mVar of
    Just BlankEntry -> error "getVarTypeByName' BlankEntry: I don't think this can happen"
    Just VarDefEntry{..} -> case vardefType of
      Just t -> pure $ Static t ctx
      Nothing -> pure $ Top (S.singleton name) ctx
    Nothing -> do
      c <- asks contract
      let mVarDecl = ((varType &&& const ctx) <$> M.lookup name (_storageDefs c))
                 <|> ((constType &&& const ctx) <$> M.lookup name (_constants c))
                 <|> (const (SVMType.Enum Nothing name Nothing, ctx) <$> M.lookup name (_enums c))
                 <|> (const (SVMType.Struct Nothing name, ctx) <$> M.lookup name (_structs c))
      case mVarDecl of
        Just (e@(SVMType.Enum{}), ctx') -> pure . Sum $
          (Static e ctx') :|
          [ Function (Static e ctx') (Static e ctx') ctx' []
          , Function (intType' ctx') (Static e ctx') ctx' []
          ]
        Just (s@(SVMType.Struct _ struct), ctx') -> do
          fields <- fmap snd <$> lookupStruct struct
          let fArgs = flip Product ctx $ flip Static ctx <$> fields
          pure . Sum $
            (Static s ctx') :|
            [ Function fArgs (Static s ctx') ctx' []
            ]
        Just (t, ctx') -> pure $ Static t ctx'
        Nothing -> case M.lookup name $ _functions c of
          Just Func{..} ->
            let fArgs = flip Product ctx $ flip Static ctx . indexedTypeType . snd <$> funcArgs
                fRets = flip Product ctx $ flip Static ctx . indexedTypeType . snd <$> funcVals
             in pure $ Function fArgs fRets ctx $ fmap buildOverloads funcOverload
          Nothing -> do
            cc <- asks codeCollection
            pure $ case M.lookup name $ _contracts cc of
              Just _->
                let ctrct = Static (SVMType.Contract name) ctx
                    lbl = Static (SVMType.UnknownLabel name Nothing) ctx
                 in Sum $ ctrct :|
                        [Function (Sum (Static (SVMType.Account False) ctx :| [ctrct, lbl]))
                           ctrct
                           ctx
                           []]
              Nothing -> do
                case M.lookup name $ _freeFuncs cc of
                    Just Func{..} ->
                      let fArgs = flip Product ctx $ flip Static ctx . indexedTypeType . snd <$> funcArgs
                          fRets = flip Product ctx $ flip Static ctx . indexedTypeType . snd <$> funcVals
                      in Function fArgs fRets ctx
                    Nothing -> bottom $ ("Unknown variable: " <> labelToText name) <$ ctx
            
  where lookupVar m Nothing = M.lookup name m
        lookupVar _ t       = t
        buildOverloads overloadFunc = Function { functionArgType = flip Product ctx $ flip Static ctx . indexedTypeType . snd <$> funcArgs overloadFunc
                                   , functionReturnType = flip Product ctx $ flip Static ctx . indexedTypeType . snd <$> funcVals overloadFunc
                                   , functionContext = funcContext overloadFunc
                                   , functionOverloads = []
                                   }

setVarType' :: SourceAnnotation Text -> SolidString -> Type -> SSS Type'
setVarType' ctx name ty = state setType'
  where setType' (m:|ms) = case M.lookup name $ snd m of
          Nothing -> case ms of
            [] -> (bottom $ ("Unknown variable: " <> labelToText name) <$ ctx, m:|[])
            (r:est) -> NE.cons m <$> setType' (r:|est)
          Just BlankEntry -> (bottom $ ("Variable listed as BlankEntry: " <> labelToText name) <$ ctx, m:|ms)
          Just t@VarDefEntry{..} -> case vardefType of
            Nothing ->
              let t' = t{vardefType = Just ty}
               in (Static ty ctx, (M.insert name t' <$> m) :| ms)
            Just ty' -> case typecheckStatic ty ty' of
              Right ty'' -> (Static ty'' ctx, m:|ms)
              Left e -> (bottom $ ("Variable " <> labelToText name <> " being updated with wrong type: " <> e) <$ ctx, m:|ms)

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
statementHelper (TryCatchStatement tryStatmenets catchMap x) = do
  ts <- statementsHelper' x tryStatmenets
  es <- statementsHelper' x (concatMap snd (M.toList catchMap))
  pure $ reduceType' x [ts, es]
statementHelper (SolidityTryCatchStatement expr mtpl successStatements catchMap x) = do
  cs <- tcExpr expr
  
  let errValsToVarDefs :: [Maybe (String, SVMType.Type)] -> [Annotated VarDefEntryF]
      errValsToVarDefs [] = []
      errValsToVarDefs (Nothing : xs) = errValsToVarDefs xs
      errValsToVarDefs ((Just (name, ty)):xs) = (VarDefEntry (Just ty) Nothing name x) : (errValsToVarDefs xs)
      successValsToVarDefs :: Maybe [(String, SVMType.Type)] -> [Annotated VarDefEntryF]
      successValsToVarDefs Nothing = []
      successValsToVarDefs (Just xs) = errValsToVarDefs $ map Just xs
  let localVarDefs =  (errValsToVarDefs $ (map (fst . snd) (M.toList catchMap))) ++ successValsToVarDefs mtpl
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
  mf <- asks function
  case mf of
    Nothing -> pure . bottom $ "Cannot use keyword 'return' outside of a function" <$ x
    Just f -> do
      let fRets = flip Product x $ flip Static x . indexedTypeType . snd <$> funcVals f
      t' <- fRets ~> maybe (pure $ Product [] x) tcExpr mExpr
      modify $ \((ret, locals) :| rest) -> case ret of
        Nothing -> (Just t', locals) :| rest
        Just (Sum _) -> (Just t', locals) :| rest
        _ -> (ret, locals) :| rest
      pure t'
statementHelper (Throw x) = pure $ topType' x
statementHelper (ModifierExecutor x) = pure $ topType' x
statementHelper (EmitStatement _ vals x) =
  reduceType' x <$> traverse (tcExpr . snd) vals
statementHelper (RevertStatement _ (NamedArgs vals) x) =
  reduceType' x <$> traverse (tcExpr . snd) vals
statementHelper (RevertStatement _ (OrderedArgs vals) x) =
  reduceType' x <$> traverse tcExpr vals
statementHelper (UncheckedStatement body x) =
  statementsHelper' x body
statementHelper (AssemblyStatement _ x) = pure $ topType' x
statementHelper (SimpleStatement stmt x) = simpleStatementHelper x stmt

simpleStatementHelper :: SourceAnnotation Text -> Annotated SimpleStatementF -> SSS Type'
simpleStatementHelper x (VariableDefinition vdefs mExpr) = do
  pushLocalVariables vdefs
  let ts' = foldr varDefsToType' (topType' x) vdefs
  ts' ~> maybe (pure $ topType' x) tcExpr mExpr
simpleStatementHelper _ (ExpressionStatement expr) =
  tcExpr expr

checkIfImmuteOperationValid :: Annotated ExpressionF  ->  SSS Type'
checkIfImmuteOperationValid (Variable y a)  = do 
  lstImmutNames <- asks immutableValNames
  if null lstImmutNames
    then tcExpr (Variable y a)
    else do
      thisFuncName  <- asks functName
      let namesOfImmutesOnly = map (\x -> fst x) lstImmutNames
      let notConstructAndImmuteAissgnedValue = ( thisFuncName /= "constructor") && (a  `elem` namesOfImmutesOnly)
      let constructorAndImmuteValueOverwritten = ( thisFuncName == "constructor") && ( (a, True)  `elem` lstImmutNames)
      if notConstructAndImmuteAissgnedValue || constructorAndImmuteValueOverwritten
      then pure . bottom $ "Immutable assignment error at" <$  y 
      else tcExpr (Variable y a)
checkIfImmuteOperationValid a = tcExpr a

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
  sumType' (intType' x) (stringType' x)  ~> (checkIfImmuteOperationValid a) <~> tcExpr b
tcExpr (Binary x "-=" a b) =
  intType' x ~> (checkIfImmuteOperationValid a) <~> tcExpr b
tcExpr (Binary x "*=" a b) =
  intType' x ~> (checkIfImmuteOperationValid a) <~> tcExpr b
tcExpr (Binary x "/=" a b) =
  intType' x ~> (checkIfImmuteOperationValid a) <~> tcExpr b
tcExpr (Binary x "%=" a b) =
  intType' x ~> (checkIfImmuteOperationValid a) <~> tcExpr b
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
tcExpr (Binary _ "=" a b) =
  (checkIfImmuteOperationValid a) <~> tcExpr b
tcExpr (Binary _ _ a b) = 
  (tcExpr a <~> tcExpr b)
tcExpr (PlusPlus x a) = 
  intType' x ~> tcExpr a
tcExpr (MinusMinus x a) = do
  intType' x ~> tcExpr a
tcExpr (NewExpression x b@SVMType.Bytes{}) = pure $ Static b x
tcExpr (NewExpression x a@SVMType.Array{}) = pure $ Static a x
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
tcExpr (FunctionCall x expr args) = do
  e <- tcExpr expr
  a <- case args of
         OrderedArgs es -> productType' x <$> traverse tcExpr es
         NamedArgs es -> productType' x <$> traverse (tcExpr . snd) es
  apply e a
tcExpr (Unitary x "-" a) = intType' x ~> tcExpr a
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
    (Static t _) -> Static (SVMType.Array t Nothing) x
    _ -> t'
tcExpr (Variable x name) = getVarType' (labelToString name) x
tcExpr (ObjectLiteral x _) = pure . bottom $ "Cannot use object literals within contract definitions" <$ x
