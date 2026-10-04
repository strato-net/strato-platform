{-# LANGUAGE DataKinds, GADTs, KindSignatures, TypeOperators, TypeFamilies, RankNTypes,
             ScopedTypeVariables, LambdaCase, OverloadedStrings, ExistentialQuantification #-}
-- Typed core for the SolidVM -> Haskell-action compiler.
-- No `Value` sum type at runtime: every compiled closure has an exact Haskell type.
module Core where

import Control.Exception
import Control.Monad.Reader
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.Foldable as F
import Data.IORef
import Data.Kind (Type)
import qualified Data.Sequence as Seq
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import Data.Type.Equality
import Blockchain.Strato.Model.Address (Address (..))
import SolidVM.Model.Storable (BasicValue (..), StoragePath (..), StoragePathPiece (..))

-- ---------------------------------------------------------------- types

data Ty t where
  TInt      :: Ty Integer                 -- every int/uint width (unbounded, see notes)
  TBool     :: Ty Bool
  TAddr     :: Ty Address
  TStr      :: Ty T.Text
  TBytes    :: Ty B.ByteString
  TEnum     :: T.Text -> [T.Text] -> Ty Integer   -- distinct from TInt in tyEq
  TContract :: T.Text -> Ty Address               -- distinct from TAddr in tyEq
  TUnit     :: Ty ()
  TArr      :: Ty t -> Ty (Seq.Seq t)
  TStruct   :: T.Text -> Fields ts -> Ty (HL ts)
  TTuple    :: Fields ts -> Ty (HL ts)
  TVariadic :: Ty [Dyn]                   -- the only dynamic type: tx args / `variadic` / `.call` results
  TMaybe    :: Ty t -> Ty (Maybe t)       -- internal: modifier return slot
  TRef      :: SType -> Ty StoragePath    -- `storage` pointer (local, parameter or return value) with its layout

-- storage layout of a state variable / storage pointer
data SType = SScalar SomeTy | SMap SomeTy SType | SStruct T.Text [(T.Text, SType)] | SArray SType

showST :: SType -> T.Text
showST = \case
  SScalar (SomeTy t) -> showTy t
  SMap (SomeTy k) v -> "mapping(" <> showTy k <> "=>" <> showST v <> ")"
  SStruct n _ -> "struct " <> n
  SArray e -> showST e <> "[]"

data Fields (ts :: [Type]) where
  FNil  :: Fields '[]
  FCons :: T.Text -> Ty t -> Fields ts -> Fields (t ': ts)

-- typed record / tuple
data HL (ts :: [Type]) where
  HNil :: HL '[]
  (:*) :: t -> HL ts -> HL (t ': ts)
infixr 5 :*

tyEq :: Ty a -> Ty b -> Maybe (a :~: b)
tyEq TInt TInt = Just Refl
tyEq TBool TBool = Just Refl
tyEq TAddr TAddr = Just Refl
tyEq TStr TStr = Just Refl
tyEq TBytes TBytes = Just Refl
tyEq (TEnum a _) (TEnum b _) | a == b = Just Refl
tyEq (TContract a) (TContract b) | a == b = Just Refl
tyEq TUnit TUnit = Just Refl
tyEq (TArr a) (TArr b) = (\Refl -> Refl) <$> tyEq a b
tyEq (TStruct n fs) (TStruct m gs) | n == m = (\Refl -> Refl) <$> fieldsEq fs gs
tyEq (TTuple fs) (TTuple gs) = (\Refl -> Refl) <$> fieldsEq fs gs
tyEq TVariadic TVariadic = Just Refl
tyEq (TMaybe a) (TMaybe b) = (\Refl -> Refl) <$> tyEq a b
tyEq (TRef a) (TRef b) | showST a == showST b = Just Refl
tyEq _ _ = Nothing

fieldsEq :: Fields a -> Fields b -> Maybe (a :~: b)
fieldsEq FNil FNil = Just Refl
fieldsEq (FCons _ t ts) (FCons _ u us) = do Refl <- tyEq t u; Refl <- fieldsEq ts us; Just Refl
fieldsEq _ _ = Nothing

showTy :: Ty t -> T.Text
showTy = \case
  TInt -> "int"; TBool -> "bool"; TAddr -> "address"; TStr -> "string"; TBytes -> "bytes"
  TEnum n _ -> "enum " <> n; TContract n -> "contract " <> n; TUnit -> "()"
  TArr t -> showTy t <> "[]"; TStruct n _ -> "struct " <> n; TTuple fs -> "(" <> T.intercalate "," (fieldTys fs) <> ")"
  TVariadic -> "variadic"; TMaybe t -> "Maybe " <> showTy t; TRef st -> showST st <> " storage"
  where
    fieldTys :: Fields ts -> [T.Text]
    fieldTys FNil = []
    fieldTys (FCons _ t rest) = showTy t : fieldTys rest

data SomeTy = forall t. SomeTy (Ty t)
data Dyn = forall t. Dyn (Ty t) t

showDyn :: Dyn -> T.Text
showDyn (Dyn t v) = case t of
  TInt -> T.pack (show v); TBool -> T.pack (show v); TAddr -> T.pack (show v); TStr -> T.pack (show v)
  TBytes -> T.pack (show v); TEnum n ns -> n <> "." <> (if fromIntegral v < length ns then ns !! fromIntegral v else T.pack (show v))
  TContract n -> n <> "(" <> T.pack (show v) <> ")"; TUnit -> "()"
  TArr et -> "[" <> T.intercalate "," (map (showDyn . Dyn et) (F.toList v)) <> "]"
  TStruct n fs -> n <> "{" <> T.intercalate "," (showFields fs v) <> "}"
  TTuple fs -> "(" <> T.intercalate "," (showFields fs v) <> ")"
  TVariadic -> "[" <> T.intercalate "," (map showDyn v) <> "]"; TMaybe _ -> "<maybe>"; TRef _ -> T.pack (show v)
  where
    showFields :: Fields ts -> HL ts -> [T.Text]
    showFields FNil HNil = []
    showFields (FCons n ft rest) (x :* xs) = (if T.null n then "" else n <> "=") <> showDyn (Dyn ft x) : showFields rest xs

defaultOf :: Ty t -> t
defaultOf = \case
  TInt -> 0; TBool -> False; TAddr -> Address 0; TStr -> ""; TBytes -> ""
  TEnum _ _ -> 0; TContract _ -> Address 0; TUnit -> (); TArr _ -> Seq.empty
  TStruct _ fs -> defaults fs; TTuple fs -> defaults fs
  TVariadic -> []; TMaybe _ -> Nothing; TRef _ -> StoragePath []
  where
    defaults :: Fields ts -> HL ts
    defaults FNil = HNil
    defaults (FCons _ t rest) = defaultOf t :* defaults rest

-- field access on typed records
hget :: Ix ts t -> HL ts -> t
hget IZ (x :* _) = x
hget (IS i) (_ :* xs) = hget i xs

hset :: Ix ts t -> t -> HL ts -> HL ts
hset IZ v (_ :* xs) = v :* xs
hset (IS i) v (x :* xs) = x :* hset i v xs

-- Storage decoding uses the *declared* type; the stored tag is only checked for gross mismatch.
fromBasic :: Ty t -> BasicValue -> Either T.Text t
fromBasic t v = case (t, v) of
  (_, BDefault) -> Right (defaultOf t)
  (TInt, BInteger n) -> Right n
  (TEnum _ _, BEnumVal _ _ w) -> Right (fromIntegral w)
  (TEnum _ _, BInteger n) -> Right n
  (TBool, BBool b) -> Right b
  (TAddr, BAddress a) -> Right a
  (TAddr, BContract _ a) -> Right a
  (TContract _, BContract _ a) -> Right a
  (TContract _, BAddress a) -> Right a
  (TStr, BString s) -> Right (TE.decodeUtf8 s)
  (TBytes, BBytes s) -> Right s
  (TBytes, BString s) -> Right s
  _ -> Left ("storage value " <> T.pack (show v) <> " does not fit declared type " <> showTy t)

-- Keep the existing storage format (tags, BDefault for zero values).
toBasic :: Ty t -> t -> BasicValue
toBasic t v = case t of
  TInt -> if v == 0 then BDefault else BInteger v
  TEnum n ns -> if v == 0 then BDefault else BEnumVal n (if fromIntegral v < length ns then ns !! fromIntegral v else "") (fromIntegral v)
  TBool -> if v then BBool True else BDefault
  TAddr -> if v == Address 0 then BDefault else BAddress v
  TContract n -> if v == Address 0 then BDefault else BContract n v
  TStr -> if T.null v then BDefault else BString (TE.encodeUtf8 v)
  TBytes -> if B.null v then BDefault else BBytes v
  _ -> BDefault

-- Mapping-key encoding, identical to SolidVM's expToPath so existing state stays readable.
encodeKey :: Ty t -> t -> StoragePathPiece
encodeKey t v = Index $ case t of
  TAddr -> BC.pack (show v)
  TContract _ -> BC.pack (show v)
  TInt -> BC.pack (show v)
  TEnum _ _ -> BC.pack (show v)
  TBool -> if v then "true" else "false"
  TStr -> TE.encodeUtf8 v
  TBytes -> v
  _ -> error "encodeKey: not a key type"

-- ---------------------------------------------------------------- typed environments

data Env (ls :: [Type]) where
  ENil :: Env '[]
  (:&) :: IORef t -> Env ls -> Env (t ': ls)
infixr 5 :&

data Ix (ls :: [Type]) t where
  IZ :: Ix (t ': ls) t
  IS :: Ix ls t -> Ix (u ': ls) t

ref :: Ix ls t -> Env ls -> IORef t
ref IZ (r :& _) = r
ref (IS i) (_ :& env) = ref i env

-- ---------------------------------------------------------------- runtime

data CallKind = Call | DelegateCall deriving (Eq, Show)

data Frame = Frame
  { fThis :: Address      -- storage/identity context
  , fCode :: Address      -- where the running code lives (differs from fThis under delegatecall)
  , fSender :: Address
  , fOrigin :: Address
  , fSig :: T.Text        -- SolidVM msg.sig = function name
  , fArgs :: [Dyn]        -- SolidVM msg.data = the call's arguments
  , fValue :: Integer
  }

-- A revert carries a message; it unwinds to the nearest try/catch or external call boundary.
newtype Revert = Revert T.Text deriving Show
instance Exception Revert

-- Semantic divergence from the typed model (e.g. storage tag mismatch, dynamic arg of wrong type).
-- Reported, never papered over (criterion 12).
newtype Divergence = Divergence T.Text deriving Show
instance Exception Divergence

data RT = RT
  { rtGet  :: Address -> StoragePath -> IO BasicValue
  , rtPut  :: Address -> StoragePath -> BasicValue -> IO ()
  , rtEmit :: Frame -> T.Text -> T.Text -> [(T.Text, Dyn)] -> IO ()   -- contract name, event name, args
  , rtCall :: CallKind -> Frame -> Address -> T.Text -> [Dyn] -> Maybe SomeTy -> IO [Dyn]
  , rtBlockNumber :: Integer
  , rtTimestamp :: Integer
  }

type M = ReaderT (RT, Frame) IO

rt :: M RT
rt = asks fst

frame :: M Frame
frame = asks snd

revert :: T.Text -> M a
revert = liftIO . throwIO . Revert

diverge :: T.Text -> M a
diverge = liftIO . throwIO . Divergence

readSlot :: Ty t -> StoragePath -> M t
readSlot t p = do
  (r, f) <- ask
  v <- liftIO $ rtGet r (fThis f) p
  either diverge pure (fromBasic t v)

writeSlot :: Ty t -> StoragePath -> t -> M ()
writeSlot t p v = do
  (r, f) <- ask
  liftIO $ rtPut r (fThis f) p (toBasic t v)

snocP :: StoragePath -> StoragePathPiece -> StoragePath
snocP (StoragePath ps) p = StoragePath (ps ++ [p])

-- Whole values in storage: scalars are one slot; arrays are `length` + indexed slots; structs are fields.
readVal :: Ty t -> StoragePath -> M t
readVal t p = do
  (r, f) <- ask
  readValWith (liftIO . rtGet r (fThis f)) t p

readValWith :: forall m t. MonadIO m => (StoragePath -> m BasicValue) -> Ty t -> StoragePath -> m t
readValWith getSlot t p = case t of
  TArr et -> do
    n <- readSlotWith TInt (snocP p (Field "length"))
    Seq.fromList <$> mapM (\i -> readValWith getSlot et (snocP p (Index (BC.pack (show i))))) [0 .. n - 1]
  TStruct _ fs -> readFields fs
  TTuple fs -> readFields fs
  _ -> readSlotWith t p
  where
    readSlotWith :: Ty a -> StoragePath -> m a
    readSlotWith ty path = getSlot path >>= either (liftIO . throwIO . Divergence) pure . fromBasic ty
    readFields :: Fields ts -> m (HL ts)
    readFields FNil = pure HNil
    readFields (FCons n ft rest) = (:*) <$> readValWith getSlot ft (snocP p (Field (TE.encodeUtf8 n))) <*> readFields rest

writeVal :: Ty t -> StoragePath -> t -> M ()
writeVal t p v = case t of
  TArr et -> do
    old <- readSlot TInt (snocP p (Field "length"))
    writeSlot TInt (snocP p (Field "length")) (fromIntegral (Seq.length v))
    F.forM_ (zip [0 :: Integer ..] (F.toList v)) $ \(i, x) -> writeVal et (snocP p (Index (BC.pack (show i)))) x
    F.forM_ [fromIntegral (Seq.length v) .. old - 1] $ \i -> writeVal et (snocP p (Index (BC.pack (show i)))) (defaultOf et)
  TStruct _ fs -> writeFields fs v
  TTuple fs -> writeFields fs v
  _ -> writeSlot t p v
  where
    writeFields :: Fields ts -> HL ts -> M ()
    writeFields FNil HNil = pure ()
    writeFields (FCons n ft rest) (x :* xs) = writeVal ft (snocP p (Field (TE.encodeUtf8 n))) x >> writeFields rest xs

-- ---------------------------------------------------------------- functions with exact signatures

data Sig (args :: [Type]) r where
  SigNil  :: Ty r -> Sig '[] r
  SigCons :: Ty a -> Sig as r -> Sig (a ': as) r

type family Fn (args :: [Type]) r where
  Fn '[] r = M r
  Fn (a ': as) r = a -> Fn as r

-- A compiled function: its exact signature and the Haskell action of exactly that type.
data Fun = forall args r. Fun T.Text (Sig args r) (Fn args r)

sigEq :: Sig a r -> Sig b s -> Maybe (Sig a r :~: Sig b s)
sigEq (SigNil r) (SigNil s) = (\Refl -> Refl) <$> tyEq r s
sigEq (SigCons a as) (SigCons b bs) = do
  Refl <- tyEq a b
  Refl <- sigEq as bs
  Just Refl
sigEq _ _ = Nothing

sigRet :: Sig args r -> Ty r
sigRet (SigNil r) = r
sigRet (SigCons _ s) = sigRet s

sigArity :: Sig args r -> Int
sigArity (SigNil _) = 0
sigArity (SigCons _ s) = 1 + sigArity s

showSig :: Sig args r -> T.Text
showSig (SigNil r) = "M " <> showTy r
showSig (SigCons a s) = showTy a <> " -> " <> showSig s

-- Build the typed action from a body that sees its arguments as typed mutable locals.
-- First argument is at index IZ.
mkFn :: Sig args r -> (Env args -> M r) -> Fn args r
mkFn (SigNil _) body = body ENil
mkFn (SigCons _ rest) body = \a -> mkFn rest (\env -> do r <- liftIO (newIORef a); body (r :& env))

-- The dynamic boundary (tx args, .call results): check each arg once, then run the typed action.
callDyn :: Sig args r -> Fn args r -> [Dyn] -> M [Dyn]
callDyn (SigNil r) f [] = do v <- f; pure (retDyn r v)
callDyn (SigCons t rest) f (d : ds) = do v <- fromDyn t d; callDyn rest (f v) ds
callDyn s _ ds = diverge ("arity mismatch at call boundary: expected " <> T.pack (show (sigArity s)) <> " more, got " <> T.pack (show (length ds)))

-- address <-> contract and int <-> enum share a wire value; the typed side decides.
fromDyn :: Ty t -> Dyn -> M t
fromDyn t (Dyn t' v) = case tyEq t t' of
  Just Refl -> pure v
  Nothing -> case (t, t') of
    (TAddr, TContract _) -> pure v
    (TContract _, TAddr) -> pure v
    (TContract _, TContract _) -> pure v
    (TInt, TEnum _ _) -> pure v
    (TEnum _ _, TInt) -> pure v
    (TBytes, TStr) -> pure (TE.encodeUtf8 v)
    (TStr, TBytes) -> pure (TE.decodeUtf8 v)
    (TArr et, TArr et') -> mapM (fromDyn et . Dyn et') v
    (TArr et, TVariadic) -> Seq.fromList <$> mapM (fromDyn et) v
    (TTuple fs, TVariadic) -> fromDyns fs v
    (TStruct _ fs, TVariadic) -> fromDyns fs v
    (TVariadic, _) -> pure [Dyn t' v]
    _ -> diverge ("value of type " <> showTy t' <> " where " <> showTy t <> " was declared")

fromDyns :: Fields ts -> [Dyn] -> M (HL ts)
fromDyns FNil [] = pure HNil
fromDyns (FCons _ t rest) (d : ds) = (:*) <$> fromDyn t d <*> fromDyns rest ds
fromDyns _ _ = diverge "tuple arity mismatch at call boundary"

retDyn :: Ty r -> r -> [Dyn]
retDyn TUnit () = []
retDyn TVariadic ds = ds
retDyn (TTuple fs) hl = toDyns fs hl
retDyn r v = [Dyn r v]

toDyns :: Fields ts -> HL ts -> [Dyn]
toDyns FNil HNil = []
toDyns (FCons _ t rest) (x :* xs) = Dyn t x : toDyns rest xs

-- Convert a text tx argument to the declared parameter type (the other dynamic boundary).
dynFromText :: Ty t -> T.Text -> Either T.Text Dyn
dynFromText t s = case t of
  TInt -> Dyn TInt <$> readInt
  TEnum _ _ -> Dyn t <$> readInt
  TBool -> Dyn TBool <$> (case s of "true" -> Right True; "false" -> Right False; _ -> Left ("not a bool: " <> s))
  TAddr -> Dyn TAddr <$> readAddr
  TContract _ -> Dyn t <$> readAddr
  TStr -> Right (Dyn TStr s)
  TBytes -> Right (Dyn TBytes (TE.encodeUtf8 s))
  _ -> Left ("cannot pass a " <> showTy t <> " as a tx argument")
  where
    readInt :: Either T.Text Integer
    readInt = case reads (T.unpack s) of [(n, "")] -> Right n; _ -> Left ("not an integer: " <> s)
    readAddr :: Either T.Text Address
    readAddr = case reads ("0x" ++ T.unpack (T.dropWhile (== '0') (fromMaybe' (T.stripPrefix "0x" s)))) :: [(Integer, String)] of
      [(n, "")] -> Right (Address (fromIntegral n))
      _ -> if T.all (== '0') s then Right (Address 0) else Left ("not an address: " <> s)
    fromMaybe' = maybe s id

-- ---------------------------------------------------------------- control flow

data Flow r = Next | Brk | Cnt | Ret r
