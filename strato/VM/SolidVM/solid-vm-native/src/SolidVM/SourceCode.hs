{-# LANGUAGE GADTs, OverloadedStrings, FlexibleInstances, TemplateHaskell, ExistentialQuantification, LambdaCase, ScopedTypeVariables #-}
-- Inspection representations are never used by the executable compiler.
module SolidVM.SourceCode where

import SolidVM.Core hiding (Fun(..))
import qualified SolidVM.Core as Core
import qualified SolidVM.BuiltinSource as BuiltinSource
import Data.Char (ord, isAscii, isAlphaNum)
import Numeric (showHex)
import Language.Haskell.TH hiding (Code)
import Data.Data (Data, cast, gmapT)
import qualified Data.Text as T
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.Text.Encoding as TE
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import SolidVM.Model.CodeCollection (Func)
import qualified Data.Sequence
import Data.Decimal
import Data.IORef (IORef)
import Blockchain.Strato.Model.Address (Address(..))
import SolidVM.Model.Storable (StoragePath(..), StoragePathPiece(..))

-- The executable field lets the shared compiler retain its existing Haskell
-- types. Inspection only demands the expression field, never executes it.
data Code a = Code { runCode :: a, sourceExpression :: Exp, codeName :: Maybe T.Text, codeType :: Maybe Type }

data Fun = forall args r. Fun T.Text (Sig args r) (Code (Fn args r))

class ToSource a where
  toSource :: a -> Exp

instance ToSource (Code a) where
  toSource code = maybe (sourceExpression code) (SigE (sourceExpression code)) (codeType code)
instance ToSource Integer where toSource = LitE . IntegerL
instance ToSource Int where toSource = LitE . IntegerL . fromIntegral
instance ToSource Bool where toSource True = ConE 'True; toSource False = ConE 'False
instance ToSource T.Text where toSource = LitE . StringL . T.unpack
instance ToSource B.ByteString where toSource b = AppE (VarE 'B.pack) (toSource (map fromIntegral (B.unpack b) :: [Integer]))
instance ToSource Address where toSource (Address a) = AppE (ConE 'Address) (LitE (IntegerL (fromIntegral a)))
instance ToSource Decimal where toSource d = AppE (ConE 'Decimal) (LitE (IntegerL (fromIntegral (decimalPlaces d)))) `AppE` LitE (IntegerL (decimalMantissa d))
instance ToSource a => ToSource [a] where toSource = ListE . map toSource
instance ToSource a => ToSource (Maybe a) where toSource Nothing = ConE 'Nothing; toSource (Just a) = AppE (ConE 'Just) (toSource a)
instance (ToSource a, ToSource b) => ToSource (a,b) where toSource (a,b) = TupE [Just (toSource a),Just (toSource b)]
instance ToSource SomeTy where toSource (SomeTy t) = AppE (ConE 'SomeTy) (toSource t)
instance ToSource SType where
  toSource = \case
    SScalar t -> app 'SScalar [toSource t]
    SMap k v -> app 'SMap [toSource k,toSource v]
    SStruct n fs -> app 'SStruct [toSource n,toSource fs]
    SArray e -> app 'SArray [toSource e]
instance ToSource (Ty a) where
  toSource = \case
    TInt -> ConE 'TInt; TDecimal -> ConE 'TDecimal; TBool -> ConE 'TBool
    TAddr -> ConE 'TAddr; TStr -> ConE 'TStr; TBytes -> ConE 'TBytes; TUnit -> ConE 'TUnit
    TEnum n ns -> app 'TEnum [toSource n,toSource ns]
    TContract n -> app 'TContract [toSource n]
    TArr t -> app 'TArr [toSource t]
    TStruct n fs -> app 'TStruct [toSource n,toSource fs]
    TTuple fs -> app 'TTuple [toSource fs]
    TVariadic -> ConE 'TVariadic; TRaw -> ConE 'TRaw; TWireArray -> ConE 'TWireArray
    TWireEnum n label -> app 'TWireEnum [toSource n,toSource label]
    TAlias t st -> app 'TAlias [toSource t,toSource st]
    TMaybe t -> app 'TMaybe [toSource t]
    TRef st -> app 'TRef [toSource st]
instance ToSource (Fields ts) where
  toSource FNil = ConE 'FNil
  toSource (FCons n t rest) = app 'FCons [toSource n,toSource t,toSource rest]
instance ToSource (Sig args r) where
  toSource (SigNil r) = app 'SigNil [toSource r]
  toSource (SigCons t rest) = app 'SigCons [toSource t,toSource rest]
instance ToSource (Ix ts t) where
  toSource IZ = ConE 'IZ
  toSource (IS i) = app 'IS [toSource i]
instance ToSource StoragePath where toSource (StoragePath xs) = app 'StoragePath [toSource xs]
instance ToSource StoragePathPiece where
  toSource (Field s) = app 'Field [toSource s]
  toSource (Index s) = app 'Index [toSource s]
instance ToSource CallKind where
  toSource Call = ConE 'Call; toSource RawCall = ConE 'RawCall; toSource DelegateCall = ConE 'DelegateCall

app :: Name -> [Exp] -> Exp
app n = foldl AppE (ConE n)

substitute :: [(Name, Exp)] -> Exp -> Exp
substitute values expression =
  let bindings = [ValD (VarP name) (NormalB captured) [] | (name, captured) <- values]
      body = transform strip expression
   in if null bindings then body else LetE (PragmaD (LineP 0 "solidvm-captures") : bindings) body
  where
    strip (AppE (AppE (VarE mapper) (VarE n)) e) | nameBase mapper == "map" && nameBase n == "runCode" = e
    strip (AppE (VarE n) e) | nameBase n == "runCode" = e
    strip e = e

transform :: (Exp -> Exp) -> Exp -> Exp
transform f = go
  where
    go :: Data a => a -> a
    go x = case cast x of
      Just expression -> maybe x id $ cast $ f $ gmapT go (expression :: Exp)
      Nothing -> gmapT go x

literal :: Ty a -> a -> Exp
literal TInt = toSource
literal TDecimal = toSource
literal TBool = toSource
literal TAddr = toSource
literal (TContract _) = toSource
literal TStr = toSource
literal TBytes = toSource
literal (TEnum _ _) = \v -> app 'EnumValue [toSource (enumNumber v),toSource (enumIsNumber v)]
literal _ = error "compiler literal is not a scalar"

constantCode :: Ty a -> a -> Code (b -> M a)
constantCode t v = Code (\_ -> pure v) (LamE [WildP] (AppE (VarE 'pure) (literal t v))) Nothing Nothing

namedCode :: T.Text -> Code a -> Code a
namedCode n code = code { codeName = Just n }

-- Distinguish overloads and constructor variants with the same display name.
-- Execution erases this operation; only inspection hashes the declaration.
namedFunction :: T.Text -> Func -> Code a -> Code a
namedFunction name declaration = namedCode (name <> "#" <> fingerprint)
  where
    fingerprint = TE.decodeUtf8 $ B16.encode $ keccak256ToByteString $ hash $ TE.encodeUtf8 $ T.pack (show declaration)

functionName :: T.Text -> Name
functionName n = mkName $ "fn_" ++ concatMap (\c -> if isAscii c && isAlphaNum c then [c] else "_" ++ showHex (ord c) "" ++ "_") (T.unpack n)

instance ToSource Fun where
  toSource (Fun n sig body) = app 'Core.Fun [toSource n,toSource sig,
    case codeName body of
      Just name -> VarE (functionName name)
      Nothing -> sourceExpression body]
instance (ToSource a, ToSource b) => ToSource (Either a b) where
  toSource (Left a) = app 'Left [toSource a]
  toSource (Right b) = app 'Right [toSource b]

builtinCode :: T.Text -> ([Dyn] -> M Dyn) -> Code ([Dyn] -> M Dyn)
builtinCode n f = Code f expression Nothing Nothing
  where
    expression = case BuiltinSource.lookupActionSource n of
      Just action -> action
      Nothing -> error "unknown compiler builtin"

haskellType :: Ty a -> Type
haskellType = \case
  TInt -> ConT ''Integer
  TDecimal -> ConT ''Decimal
  TBool -> ConT ''Bool
  TAddr -> ConT ''Address
  TContract _ -> ConT ''Address
  TStr -> ConT ''T.Text
  TBytes -> ConT ''B.ByteString
  TEnum _ _ -> ConT ''EnumValue
  TUnit -> TupleT 0
  TArr t -> AppT (ConT ''Data.Sequence.Seq) (haskellType t)
  TStruct _ fs -> AppT (ConT ''HL) (fieldTypes fs)
  TTuple fs -> AppT (ConT ''HL) (fieldTypes fs)
  TVariadic -> AppT ListT (ConT ''Dyn)
  TRaw -> AppT ListT (ConT ''Dyn)
  TWireArray -> AppT ListT (ConT ''Dyn)
  TWireEnum _ _ -> ConT ''Integer
  TAlias t _ -> AppT (AppT (ConT ''Either) (ConT ''StoragePath)) (haskellType t)
  TMaybe t -> AppT (ConT ''Maybe) (haskellType t)
  TRef _ -> ConT ''StoragePath
  where
    fieldTypes :: Fields ts -> Type
    fieldTypes FNil = PromotedNilT
    fieldTypes (FCons _ t rest) = AppT (AppT PromotedConsT (haskellType t)) (fieldTypes rest)

signatureType :: Sig args r -> Type
signatureType (SigNil r) = AppT (ConT ''M) (haskellType r)
signatureType (SigCons t rest) = AppT (AppT ArrowT (haskellType t)) (signatureType rest)

functionDeclarations :: Fun -> [Dec]
functionDeclarations (Fun _ sig body) = case codeName body of
  Just name -> [SigD (functionName name) (signatureType sig), ValD (VarP (functionName name)) (NormalB (sourceExpression body)) []]
  Nothing -> error "compiled function has no inspection name"

environmentType :: [EnvTy] -> Type
environmentType types = AppT (ConT ''Env) (foldr (\slot rest -> AppT (AppT PromotedConsT (slotType slot)) rest) PromotedNilT types)
  where
    slotType (RefSlot t) = AppT (ConT ''IORef) (haskellType t)
    slotType (ValueSlot t) = haskellType t

arrow :: Type -> Type -> Type
arrow a b = AppT (AppT ArrowT a) b

monadType :: Type -> Type
monadType = AppT (ConT ''M)

annotate :: Type -> Code a -> Code a
annotate t code = code { codeType = Just t }

typedCode :: [EnvTy] -> Ty r -> Code (Env ls -> M r) -> Code (Env ls -> M r)
typedCode env r = annotate (arrow (environmentType env) (monadType (haskellType r)))

typedBody :: [EnvTy] -> Ty r -> Code (Env ls -> M (Flow r)) -> Code (Env ls -> M (Flow r))
typedBody env r = annotate (arrow (environmentType env) (monadType (AppT (ConT ''Flow) (haskellType r))))

typedSetter :: [EnvTy] -> Ty a -> Code (Env ls -> a -> M ()) -> Code (Env ls -> a -> M ())
typedSetter env t = annotate (arrow (environmentType env) (arrow (haskellType t) (monadType (TupleT 0))))

typedPath :: [EnvTy] -> Code (Env ls -> M (Maybe StoragePath)) -> Code (Env ls -> M (Maybe StoragePath))
typedPath env = annotate (arrow (environmentType env) (monadType (AppT (ConT ''Maybe) (ConT ''StoragePath))))

typedDestination :: [EnvTy] -> Ty a -> Code (Env ls -> M (Maybe StoragePath, M a, a -> M ())) -> Code (Env ls -> M (Maybe StoragePath, M a, a -> M ()))
typedDestination env t = annotate (arrow (environmentType env) (monadType
  (AppT (AppT (AppT (TupleT 3) (AppT (ConT ''Maybe) (ConT ''StoragePath))) (monadType (haskellType t)))
    (arrow (haskellType t) (monadType (TupleT 0))))))

typedGetter :: Sig args r -> Code (StoragePath -> Env (RefTypes args) -> M r) -> Code (StoragePath -> Env (RefTypes args) -> M r)
typedGetter sig = annotate (arrow (ConT ''StoragePath) (arrow (arguments sig) (monadType (haskellType (sigRet sig)))))
  where
    arguments :: Sig args r -> Type
    arguments = environmentType . types
    types :: Sig args r -> [EnvTy]
    types (SigNil _) = []
    types (SigCons t rest) = RefSlot t : types rest

typedDestructure :: [EnvTy] -> Fields ts -> Ty r -> Code (Env ls -> HL ts -> M (Flow r)) -> Code (Env ls -> HL ts -> M (Flow r))
typedDestructure env fs r = annotate (arrow (environmentType env)
  (arrow (haskellType (TTuple fs)) (monadType (AppT (ConT ''Flow) (haskellType r)))))

typedTupleSetters :: [EnvTy] -> Fields ts -> Code (Env ls -> M (HL ts -> M ())) -> Code (Env ls -> M (HL ts -> M ()))
typedTupleSetters env fs = annotate (arrow (environmentType env)
  (monadType (arrow (haskellType (TTuple fs)) (monadType (TupleT 0)))))
