{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingVia #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE PatternSynonyms #-}
{-# LANGUAGE ViewPatterns #-}
{-# OPTIONS_GHC -fno-warn-orphans #-} -- Generic/Store (DecimalRaw i)

module SolidVM.Model.Value
  ( Variable (..),
    Value (.., SIntegral),
    unsignedInteger,
    integerResult,
    coerceUnsignedValue,
    ValList,
    toNull,
    rlpEncodeVariable,
    rlpEncodeValue,
    rlpEncodeValues,
    rlpLegacyValue,
    createVar,
    coerceType,
    defaultValue,
    createDefaultValue,
    createDefaultValueWith,
    valEquals,
    valueTypeName,
    getConst,
    weakGetVar,
    forceLoadVar,
    renderValue,
    renderValueShallow,
  )
where

import Control.Exception (throw)
import Blockchain.Data.RLP
import Blockchain.SolidVM.Exception
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Util (getUtf8String, putUtf8String)
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Base16 as B16
import Control.Applicative ((<|>))
import Control.DeepSeq (NFData, rnf)
import Control.Monad ((<=<))
import Data.Aeson (ToJSON(..), FromJSON(..), object, (.=), (.:), (.:?), (.!=))
import qualified Data.Aeson as Aeson
import qualified Data.Binary as Binary
import Text.Format
import Control.Lens ((^.))
import Control.Monad (forM, when)
import Control.Monad.IO.Class
import Data.Bool (bool)
import Data.ByteString (ByteString)
import qualified Data.ByteString as B
import Data.Decimal
import Data.Foldable (asum)
import Data.IORef
import Data.Map (Map)
import qualified Data.Map as M
import Data.Maybe (fromMaybe, listToMaybe)
import Data.Store (Size (VarSize), Store (..))
import Data.Store.Internal (getSize)
import qualified Data.Text as T
import Data.Text.Encoding (encodeUtf8)
import Data.Vector (Vector)
import qualified Data.Vector as V
import Data.Word
import GHC.Generics (Generic)
import Numeric
import Numeric.Natural (Natural)
import SolidVM.Model.CodeCollection (CodeCollection)
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.SolidString
import SolidVM.Model.Storable (StoreList (..), StoreMap (..), StoreVector (..))
import qualified SolidVM.Model.Storable as MS
import qualified SolidVM.Model.Type as SVMType

data Variable
  = Variable (IORef Value)
  | Constant Value
  | TypedVariable SVMType.Type Variable
  deriving (Eq)

instance Show Variable where
  show (Variable _) = "<variable>"
  show (Constant v) = "Constant: " ++ show v
  show (TypedVariable _ v) = show v

instance NFData Variable where rnf = (`seq` ())
instance NFData Value where rnf = (`seq` ())

--TODO- we need to figure out this ambiguity on the Address types....
--Sometimes address is and integer (solidity can treat an integer as an address),
--sometimes it is a proper type.

data Value
  = SInteger Integer
  | SDecimal Decimal
  | SString String
  | SBool Bool
  | SAddress Address Bool --isPayable
  | SUserDefined SolidString SolidString Value
  | -- This is a payable account, which means it can use .transfer() , .send() , .call() , .delegatecall() and .staticcall()
    SEnum SolidString
  | SEnumVal SolidString SolidString Word32
  | SStructDef SolidString
  | SStruct SolidString (Map SolidString Variable)
  | STuple (Vector Variable)
  | SArray (Vector Variable)
  | SMap (Map Value Variable)
  | SFunction SolidString (Maybe CC.Contract) -- Nothing means it's a builtin function
  | SBuiltinVariable SolidString
  | SSetterGetter String (Maybe Value)
  | SContractDef SolidString
  | -- | SBuiltinTypeF SolidString SolidString CodeCollection
    SContractItem Address SolidString
  | SContract SolidString Address
  | SContractFunction Address SolidString -- address, functionName
  | SPush Value (Maybe Variable) -- The array function
  | -- | SSend Value (Maybe Variable)
    -- | STransfer Value (Maybe Variable)
    -- | SDelegateCall Value (Maybe Variable)
    -- | SStaticCall Value (Maybe Variable)
    -- | SCall Value (Maybe Variable)
    SNULL
  | SReference MS.StoragePath -- An alias to an existing variable, so that modifications
  -- can be canonicalized
  | SHexDecodeAndTrim -- Hack to implement blockapps-sol's bytes32ToString without
  -- supporting indexing into bytes32s.
  | SStringConcat -- for easy concat of multiple arguments
  | SDeferredConstant SolidString -- Constant with complex expression, evaluated on access
  | SAddressToAscii -- Hack to implement addressToAsciiString without supporting indexing into bytes
  | SBreak
  | SContinue
  | SBytes ByteString
  | SVariadic [Value]
  | SUnsigned Natural
  deriving (Show, Generic)

-- Numeric consumers accept either representation; legacy constructors remain signed.
pattern SIntegral :: Integer -> Value
pattern SIntegral n <- (integerValue -> Just n) where
  SIntegral n = SInteger n

{-# COMPLETE SIntegral, SDecimal, SString, SBool, SAddress, SUserDefined, SEnum, SEnumVal, SStructDef, SStruct, STuple, SArray, SMap, SFunction, SBuiltinVariable, SSetterGetter, SContractDef, SContractItem, SContract, SContractFunction, SPush, SNULL, SReference, SHexDecodeAndTrim, SStringConcat, SDeferredConstant, SAddressToAscii, SBreak, SContinue, SBytes, SVariadic #-}

integerValue :: Value -> Maybe Integer
integerValue (SInteger n) = Just n
integerValue (SUnsigned n) = Just (toInteger n)
integerValue _ = Nothing

unsignedInteger :: Integer -> Value
unsignedInteger n
  | n < 0 = throw (ArithmeticException "unsigned integer underflow" (show n))
  | otherwise = SUnsigned (fromInteger n)

integerResult :: Bool -> Integer -> Value
integerResult True = unsignedInteger
integerResult False = SInteger

-- See the note on the Store instances in SolidVM.Model.Storable.
instance Store Value

deriving via (StoreList Value) instance {-# OVERLAPPING #-} Store [Value]

deriving via (StoreVector Variable) instance {-# OVERLAPPING #-} Store (Vector Variable)

deriving via (StoreMap SolidString Variable) instance {-# OVERLAPPING #-} Store (Map SolidString Variable)

deriving via (StoreMap Value Variable) instance {-# OVERLAPPING #-} Store (Map Value Variable)

-- IORef-backed variables are stored as snapshots, as in the Binary and JSON instances:
-- 'Constant' is its value, 'Variable' is SNULL; reading back gives a 'Constant'.
instance Store Variable where
  size = VarSize (getSize . snapshotVariable)
  poke = poke . snapshotVariable
  peek = Constant <$> peek

snapshotVariable :: Variable -> Value
snapshotVariable (Constant c) = c
snapshotVariable (Variable _) = SNULL
snapshotVariable (TypedVariable _ v) = snapshotVariable v

deriving instance Generic (DecimalRaw i)

instance Store i => Store (DecimalRaw i)

--TODO- Remove this sloppy half-measure of Ord, Eq definitions once we move to Solidity static typing
--This only allows for comparison within the same type of values
--(the move to static typing will probably automatically clean this up)

toNull :: Value -> Value
toNull SNULL = SNULL
toNull SReference{} = SNULL
toNull (SBool False) = SNULL
toNull (SIntegral 0) = SNULL
toNull (SDecimal 0.0) = SNULL
toNull (SString "") = SNULL
toNull (SAddress 0 _) = SNULL
toNull (SContract _ 0) = SNULL
toNull (SEnumVal _ _ 0) = SNULL
toNull (SBytes bs) | B.null bs = SNULL
toNull (SArray vs) | V.null vs = SNULL
toNull v = v

instance Eq Value where
  x == y = case (toNull x, toNull y) of
    (SNULL, SNULL) -> True
    (SIntegral i1, SIntegral i2) -> i1 == i2
    (SString s1, SString s2) -> s1 == s2
    (SDecimal v1, SDecimal v2) -> v1 == v2
    (SBool b1, SBool b2) -> b1 == b2
    (SAddress a1 b1, SAddress a2 b2) -> (a1 == a2 && b1 == b2)
    (SContract c1 a1, SContract c2 a2) -> c1 == c2 && a1 == a2
    (SEnumVal t1 _ n1, SEnumVal t2 _ n2) -> t1 == t2 && n1 == n2
    (SBytes b1, SBytes b2) -> b1 == b2
    (SString b1, SBytes b2) -> encodeUtf8 (T.pack b1) == b2
    (SBytes b1, SString b2) -> b1 == encodeUtf8 (T.pack b2)
    (SNULL, _) -> False
    (_, SNULL) -> False
    _ -> throw (TypeError "unsupported value types for equality" (format (renderValueShallow x, renderValueShallow y)))

instance Ord Value where
  compare x y = case (toNull x, toNull y) of
    (SNULL, SNULL) -> EQ
    (SIntegral i1, SIntegral i2) -> compare i1 i2
    (SString s1, SString s2) -> compare s1 s2
    (SDecimal v1, SDecimal v2) -> compare v1 v2
    (SBool b1, SBool b2) -> compare b1 b2
    (SAddress a1 _, SAddress a2 _) -> compare a1 a2
    (SBytes b1, SBytes b2) -> compare b1 b2
    (SString b1, SBytes b2) -> compare (encodeUtf8 (T.pack b1)) b2
    (SBytes b1, SString b2) -> compare b1 (encodeUtf8 (T.pack b2))
    (SNULL, _) -> LT
    (_, SNULL) -> GT
    _ -> throw (TypeError "unsupported value types for ordering" (format (renderValueShallow x, renderValueShallow y)))

instance RLPSerializable Value where
  rlpEncode = rlpEncodeValue
  rlpDecode x = throw (InternalError ("RLP decoding of Value is not supported: " ++ show x))

rlpEncodeVariable :: Variable -> RLPObject
rlpEncodeVariable (Variable _) = rlpEncodeValue SNULL
rlpEncodeVariable (Constant v) = rlpEncodeValue v
rlpEncodeVariable (TypedVariable _ v) = rlpEncodeVariable v

rlpEncodeValue :: Value -> RLPObject
rlpEncodeValue SNULL = rlpEncodeValue $ SInteger 0
rlpEncodeValue SReference{} = rlpEncodeValue $ SInteger 0
rlpEncodeValue (SIntegral i) = rlpEncode i
rlpEncodeValue (SString s) = rlpEncode s
rlpEncodeValue (SBytes bs) = rlpEncode bs
rlpEncodeValue (SDecimal decimal) = rlpEncode $ show decimal
rlpEncodeValue (SBool b) = rlpEncode b
rlpEncodeValue (SAddress a _) = rlpEncode a
rlpEncodeValue (SEnumVal _ _ i) = rlpEncode i
rlpEncodeValue (SStruct _ m) = RLPArray $ rlpEncodeVariable . snd <$> M.toList m
rlpEncodeValue (STuple v) = RLPArray $ rlpEncodeVariable <$> V.toList v
rlpEncodeValue (SArray v) = RLPArray $ rlpEncodeVariable <$> V.toList v
rlpEncodeValue (SVariadic vs) = rlpEncodeValues vs
rlpEncodeValue (SContract _ a) = rlpEncode a
rlpEncodeValue (SUserDefined _ _ v) = rlpEncodeValue v
rlpEncodeValue (SMap m) = RLPArray [RLPArray [rlpEncodeValue k, rlpEncodeVariable v] | (k, v) <- M.toList m]
rlpEncodeValue (SContractFunction a f) = RLPArray [rlpEncode a, rlpEncode f]
rlpEncodeValue (SEnum n) = rlpEncodeTagged "enum" [rlpEncode n]
rlpEncodeValue (SStructDef n) = rlpEncodeTagged "structDef" [rlpEncode n]
rlpEncodeValue (SContractDef n) = rlpEncodeTagged "contractDef" [rlpEncode n]
rlpEncodeValue (SFunction n c) = rlpEncodeTagged "function" [rlpEncode n, rlpEncode $ CC._contractName <$> c]
rlpEncodeValue (SBuiltinVariable n) = rlpEncodeTagged "builtinVariable" [rlpEncode n]
rlpEncodeValue (SSetterGetter n v) = rlpEncodeTagged "setterGetter" [rlpEncode n, rlpEncode v]
rlpEncodeValue (SContractItem a n) = rlpEncodeTagged "contractItem" [rlpEncode a, rlpEncode n]
rlpEncodeValue (SPush v _) = rlpEncodeTagged "push" [rlpEncodeValue v]
rlpEncodeValue SHexDecodeAndTrim = rlpEncodeTagged "hexDecodeAndTrim" []
rlpEncodeValue SStringConcat = rlpEncodeTagged "stringConcat" []
rlpEncodeValue (SDeferredConstant n) = rlpEncodeTagged "deferredConstant" [rlpEncode n]
rlpEncodeValue SAddressToAscii = rlpEncodeTagged "addressToAscii" []
rlpEncodeValue SBreak = rlpEncodeTagged "break" []
rlpEncodeValue SContinue = rlpEncodeTagged "continue" []

-- | Values that are not data (type names, builtins, bound members, control
-- flow) are encoded as their constructor tag followed by their fields, so no
-- two of them share an encoding.
rlpEncodeTagged :: String -> [RLPObject] -> RLPObject
rlpEncodeTagged tag fields = RLPArray $ rlpEncode tag : fields

-- | Rewrites a value so 'rlpEncodeValue' gives its encoding from before the RLP
-- encode fork, when every value without a data case of its own encoded as
-- @RLPArray []@, the same as an empty tuple.
rlpLegacyValue :: Value -> Value
rlpLegacyValue = \case
  SStruct n m -> SStruct n $ legacyVar <$> m
  STuple v -> STuple $ legacyVar <$> v
  SArray v -> SArray $ legacyVar <$> v
  SVariadic vs -> SVariadic $ rlpLegacyValue <$> vs
  v@SNULL -> v
  v@SReference{} -> v
  v@SIntegral{} -> v
  v@SString{} -> v
  v@SBytes{} -> v
  v@SDecimal{} -> v
  v@SBool{} -> v
  v@SAddress{} -> v
  v@SEnumVal{} -> v
  _ -> STuple V.empty
  where
    legacyVar (Constant v) = Constant $ rlpLegacyValue v
    legacyVar var = var

rlpEncodeValues :: [Value] -> RLPObject
rlpEncodeValues [x] = rlpEncodeValue x
rlpEncodeValues xs = rlpEncodeValue $ STuple $ V.fromList $ Constant <$> xs

-- coerceFromInt is useful to force integer literals
-- to assume the type that was intended for them, once
-- it is determined that their expected type is
coerceFromInt :: CC.Contract -> CodeCollection -> Value -> Integer -> Value
coerceFromInt _ _ SIntegral {} n = SInteger n
coerceFromInt _ _ (SAddress _ b) n = SAddress (fromIntegral n) b
coerceFromInt _ _ SBool {} n = SBool $ n /= 0
coerceFromInt _ _ SString {} 0 = SString ""
coerceFromInt _ _ SString {} n = SString $ showHex n ""
coerceFromInt _ _ SDecimal {} n = SDecimal $ Decimal 0 n
coerceFromInt _ _ (SContract c _) n = SContract c $ fromIntegral n
coerceFromInt ct cc (SEnumVal tipe _ _) n' =
  fromMaybe (throw (TypeError "missing enum val" $ format (tipe, n'))) $ do
    let n = fromIntegral n'
    -- Look up enum in contract first, then fall back to file-level enums
    enumDef <- fmap fst $ M.lookup tipe (CC._enums ct) <|> M.lookup tipe (cc ^. CC.flEnums)
    when (n >= length enumDef) $ fail "enum val out of range"
    return $ SEnumVal tipe (enumDef !! n) $ fromIntegral n'
coerceFromInt _ _ SNULL n = SInteger n
coerceFromInt _ _ SReference{} n = SInteger n
coerceFromInt _ _ t x = throw (TypeError "coerceFromInt: invalid literal for type" $ format (renderValueShallow t, x))

-- coerceType allows integer literals to initialize integers, addresses, and
-- strings (in the special case of 0) and bytes32, determined by type instead of value
coerceType :: CC.Contract -> CodeCollection -> SVMType.Type -> Value -> Value
coerceType ct cc xt = \case
  SIntegral i -> coerceFromInt ct cc (defaultValue ct xt) i
  SString s -> case xt of
    SVMType.String {} -> SString s
    SVMType.Bytes {} -> SString s
    SVMType.Decimal {} -> SDecimal (read s :: Decimal)
    _ -> throw (TypeError "string literal must be string or bytes" $ show xt ++ ": " ++ s)
  v -> v

coerceUnsignedValue :: MonadIO m => CC.Contract -> CodeCollection -> SVMType.Type -> Value -> m Value
coerceUnsignedValue ct cc t value = case (t, value) of
  (SVMType.Int (Just False) _, SIntegral n) -> pure $! unsignedInteger n
  (SVMType.Int (Just False) _, SNULL) -> pure SNULL
  (SVMType.Int (Just False) _, SVariadic [v]) -> coerceUnsignedValue ct cc t v
  (SVMType.Int (Just False) _, SReference _) -> pure value
  (SVMType.Int (Just False) _, _) -> throw (TypeError "expected unsigned integer" (show value))
  (SVMType.Int _ _, SUnsigned n) -> pure (SInteger $ toInteger n)
  (SVMType.Array element _, SArray items) -> SArray <$> traverse (typed element) items
  (SVMType.Mapping _ _ element _ _, SMap items) -> SMap <$> traverse (typed element) items
  (SVMType.UserDefined _ actual, _) -> coerceUnsignedValue ct cc actual value
  (SVMType.Struct _ name, _) -> coerceUnsignedValue ct cc (SVMType.UnknownLabel name) value
  (SVMType.UnknownLabel name, _) | prefix : rest <- T.splitOn "." name, not (null rest), Just owner <- M.lookup prefix (cc ^. CC.contracts) ->
    coerceUnsignedValue owner cc (SVMType.UnknownLabel $ T.intercalate "." rest) value
  (_, SStruct name fields) -> case M.lookup name (CC._structs ct) <|> M.lookup name (cc ^. CC.flStructs) of
    Nothing -> pure value
    Just defs -> do
      let types = M.fromList [(n, CC.fieldTypeType f) | (n, f, _) <- defs]
      SStruct name <$> M.traverseWithKey (\n v -> maybe (pure v) (`typed` v) (M.lookup n types)) fields
  _ -> pure value
  where
    typed typ var@(TypedVariable existing _) | typ == existing = pure var
    typed typ var = do
      v <- weakGetVar var
      checked <- coerceUnsignedValue ct cc typ v
      checked `seq` pure (TypedVariable typ var)

valEquals :: CC.Contract -> CodeCollection -> Value -> Value -> Bool
valEquals ct cc lhs rhs = case (lhs, rhs) of
  (SIntegral _, SIntegral _) -> lhs == rhs
  (SIntegral i, _) -> coerceFromInt ct cc rhs i == rhs
  (_, SIntegral i) -> lhs == coerceFromInt ct cc lhs i
  _ -> lhs == rhs

createVar' :: MonadIO m => Value -> m Variable
createVar' val = liftIO $ Variable <$> newIORef val

toVar :: MonadIO m => Variable -> m Variable
toVar (Constant val) = createVar val
toVar (TypedVariable t var) = TypedVariable t <$> toVar var
toVar var            = pure var

createVar :: MonadIO m => Value -> m Variable
createVar val = createVar' =<< case val of
  SStruct n m -> SStruct n <$> traverse toVar m
  STuple vs -> STuple <$> traverse toVar vs
  SArray vs -> SArray <$> traverse toVar vs
  SMap m -> SMap <$> traverse toVar m
  SPush v mv -> SPush v <$> traverse toVar mv
  _ -> pure val

--TODO- defaultValue is deprecated, will be removed...  Instead use createDefaultValue
defaultValue :: CC.Contract -> SVMType.Type -> Value
defaultValue _ (SVMType.Array _ _) = SArray V.empty
defaultValue _ (SVMType.Mapping _ _ _ _ _) = SMap M.empty
defaultValue _ (SVMType.Int _ _) = SInteger 0
defaultValue _ SVMType.Bool = SBool False
defaultValue _ (SVMType.Address _) = (SAddress 0) False
defaultValue _ (SVMType.String _) = SString ""
defaultValue _ (SVMType.Bytes _ mSize) = SBytes $ case mSize of
  Just n -> BC.replicate (fromIntegral n) '\0'
  Nothing -> BC.empty
defaultValue _ SVMType.Decimal = SDecimal 0
defaultValue ctract (SVMType.UnknownLabel name) =
  fromMaybe (SContract name 0x0) $
    asum
      [ do
          ns <- M.lookup name $ CC._enums ctract
          val <- listToMaybe $ fst ns
          return $ SEnumVal name val 0x0,
        do
          sdef' <- M.lookup name $ CC._structs ctract
          let initializeField = Constant . defaultValue ctract . CC.fieldTypeType
              sdef = (\(a, b, _) -> (a, b)) <$> sdef'
          return . SStruct name . M.map initializeField . M.fromList $ sdef
      ]
defaultValue _ SVMType.Variadic = STuple V.empty
defaultValue _ x = throw (UnsupportedFeature "default value for type" (show x))

createDefaultValue ::
  MonadIO m =>
  CC.CodeCollection ->
  CC.Contract ->
  SVMType.Type ->
  m Value
createDefaultValue = createDefaultValueWith (pure ())

-- | 'createDefaultValue', running the given action before each struct field
-- is created, so the caller can charge for a struct by its size as it is
-- built: nested structs can make a short declaration very large.
createDefaultValueWith ::
  MonadIO m =>
  m () ->
  CC.CodeCollection ->
  CC.Contract ->
  SVMType.Type ->
  m Value
createDefaultValueWith _ _ _ (SVMType.Array _ _) = return $ SArray V.empty
createDefaultValueWith _ _ _ (SVMType.Mapping _ _ _ _ _) = return $ SMap M.empty
createDefaultValueWith _ _ _ (SVMType.Int _ _) = return $ SInteger 0
createDefaultValueWith _ _ _ SVMType.Bool = return $ SBool False
createDefaultValueWith _ _ _ (SVMType.Address _) = return $ (SAddress 0) False
createDefaultValueWith _ _ _ (SVMType.String _) = return $ SString ""
createDefaultValueWith _ _ _ (SVMType.Bytes _ mSize) = return $ SBytes $ case mSize of
  Just n -> BC.replicate (fromIntegral n) '\0'  -- Fixed-size bytes (e.g., bytes32)
  Nothing -> BC.empty  -- Dynamic bytes
createDefaultValueWith _ _ _ SVMType.Decimal = return $ SDecimal 0
createDefaultValueWith perField cc ctract (SVMType.UnknownLabel name) =
  case (M.lookup name $ CC._enums ctract, M.lookup name $ CC._structs ctract) of
    (Just ((val : _), _), _) -> return $ SEnumVal name val 0x0
    (Nothing, Just sdef) -> do
      items <-
        forM sdef $ \(n, itemType, _) -> do
          perField
          itemVal <- createDefaultValueWith perField cc ctract $ CC.fieldTypeType itemType
          itemVar <- createVar itemVal
          return (n, itemVar)
      return $ SStruct name $ M.fromList items
    _ -> do
      case (M.lookup name $ cc ^. CC.flEnums, M.lookup name $ cc ^. CC.flStructs) of
        (Just ((val : _), _), _) -> return $ SEnumVal name val 0x0
        (Nothing, Just sdef) -> do
          items <-
            forM sdef $ \(n, itemType, _) -> do
              perField
              itemVal <- createDefaultValueWith perField cc ctract $ CC.fieldTypeType itemType
              itemVar <- createVar itemVal
              return (n, itemVar)
          return $ SStruct name $ M.fromList items
        _ -> case T.splitOn "." $ labelToText name of
          [_] -> return $ SContract name 0x0
          (n:ns) -> case M.lookup (textToLabel n) $ cc ^. CC.contracts of
            Nothing -> return $ SContract name 0x0
            Just c -> createDefaultValueWith perField cc c (SVMType.UnknownLabel . textToLabel $ T.intercalate "." ns)
          _ -> return $ SContract name 0x0
createDefaultValueWith _ _ _ _ = pure SNULL

{-
byteStringToValue :: B.ByteString -> Maybe Value
byteStringToValue x | x == B.singleton 128 = Nothing
byteStringToValue x = Just . SInteger . rlpDecode . rlpDeserialize $ x

castToInt :: Value -> Integer
castToInt (SInteger i) = i
castToInt s = typeError "castToInt" $ show s
-}

-- Evaluated ArgLists
type ValList = [Value]

-- | Human-readable type name for Value constructors (used in error messages)
valueTypeName :: Value -> String
valueTypeName (SIntegral _) = "Integer"
valueTypeName (SDecimal _) = "Decimal"
valueTypeName (SString _) = "String"
valueTypeName (SBool _) = "Bool"
valueTypeName (SAddress _ _) = "Address"
valueTypeName (SUserDefined n _ _) = "UserDefined(" ++ show n ++ ")"
valueTypeName (SEnum n) = "Enum(" ++ show n ++ ")"
valueTypeName (SEnumVal n _ _) = "EnumVal(" ++ show n ++ ")"
valueTypeName (SStructDef n) = "StructDef(" ++ show n ++ ")"
valueTypeName (SStruct n _) = "Struct(" ++ show n ++ ")"
valueTypeName (STuple _) = "Tuple"
valueTypeName (SArray _) = "Array"
valueTypeName (SMap _) = "Map"
valueTypeName (SFunction n _) = "Function(" ++ show n ++ ")"
valueTypeName (SBuiltinVariable n) = "BuiltinVariable(" ++ show n ++ ")"
valueTypeName (SSetterGetter n _) = "SetterGetter(" ++ n ++ ")"
valueTypeName (SContractDef n) = "ContractDef(" ++ show n ++ ")"
valueTypeName (SContractItem _ n) = "ContractItem(" ++ show n ++ ")"
valueTypeName (SContract n _) = "Contract(" ++ show n ++ ")"
valueTypeName (SContractFunction _ n) = "ContractFunction(" ++ show n ++ ")"
valueTypeName (SPush _ _) = "Push"
valueTypeName SNULL = "Null"
valueTypeName (SReference _) = "Reference"
valueTypeName SHexDecodeAndTrim = "HexDecodeAndTrim"
valueTypeName SStringConcat = "StringConcat"
valueTypeName (SDeferredConstant n) = "DeferredConstant(" ++ show n ++ ")"
valueTypeName SAddressToAscii = "AddressToAscii"
valueTypeName SBreak = "Break"
valueTypeName SContinue = "Continue"
valueTypeName (SBytes _) = "Bytes"
valueTypeName (SVariadic _) = "Variadic"

-- | Format instance for human-readable Value output in error messages
instance Format Value where
  format (SReference path) =
    "Reference(" ++ BC.unpack (MS.unparsePath path) ++ ")"
  format (SIntegral n) = "Integer(" ++ show n ++ ")"
  format (SBool b) = "Bool(" ++ show b ++ ")"
  format (SString s) = "String(" ++ show (take 20 s) ++ if length s > 20 then "...)" else ")"
  format (SAddress a _) = "Address(" ++ take 10 (show a) ++ "...)"
  format v = valueTypeName v

instance Format Variable where
  format (Constant value) = T.unpack (renderValueShallow value)
  format (Variable _) = "variable"
  format (TypedVariable _ variable) = format variable

getConst :: Variable -> Value
getConst (Constant v) = v
getConst (Variable _) = SNULL
getConst (TypedVariable _ v) = getConst v

weakGetVar :: MonadIO m => Variable -> m Value
weakGetVar (Constant c) = return c
weakGetVar (Variable v) = liftIO $ readIORef v
weakGetVar (TypedVariable _ v) = weakGetVar v

forceLoadVar :: MonadIO m => Variable -> m Value
forceLoadVar = forceLoadVal <=< weakGetVar
  where forceLoadVal :: MonadIO m => Value -> m Value
        forceLoadVal v = case v of
          SStruct n m -> SStruct n . fmap Constant <$> traverse forceLoadVar m
          STuple vs -> STuple . fmap Constant <$> traverse forceLoadVar vs
          SArray vs -> SArray . fmap Constant <$> traverse forceLoadVar vs
          SMap m -> SMap . fmap Constant <$> traverse forceLoadVar m
          _ -> pure v

-- | Shallow, pure rendering of a value: scalars verbatim, compounds
-- summarized without dereferencing nested variables or storage.
renderValueShallow :: Value -> T.Text
renderValueShallow = \case
  SIntegral i -> T.pack (show i)
  SDecimal d -> T.pack (show d)
  SString str -> T.pack (show str)
  SBool b -> if b then "true" else "false"
  SAddress addr _ -> T.pack (show addr)
  SEnumVal enumName valName _ -> labelToText enumName <> "." <> labelToText valName
  SStruct sname _ -> "<struct " <> labelToText sname <> ">"
  STuple _ -> "<tuple>"
  SArray _ -> "<array>"
  SMap _ -> "<mapping>"
  v -> T.take 100 . T.pack $ show v

-- | JSON-ish text form of a fully evaluated value (only 'Constant' cells;
-- see 'forceLoadVar'). Used for event args wherever they are shown as text.
renderValue :: Value -> T.Text
renderValue = go False
  where
    go _ SNULL = "null"
    go _ (SIntegral v) = T.pack $ show v
    go b (SString v) = T.pack $ bool id show b v
    go b (SBytes v) = T.pack . bool id show b . BC.unpack $ B16.encode v
    go _ (SBool v) = bool "false" "true" v
    go _ (SEnumVal tn vn _) = labelToText tn <> "." <> labelToText vn
    go b (SAddress a _) = T.pack . bool id show b $ show a
    go _ (STuple v) = "[" <> T.intercalate ", " (map (go True . getConst) (V.toList v)) <> "]"
    go _ (SArray v) = "[" <> T.intercalate ", " (map (go True . getConst) (V.toList v)) <> "]"
    go _ (SStruct name m) =
      labelToText name <> "{"
        <> T.intercalate ", " [T.pack (show (labelToString n)) <> ": " <> go True (getConst var) | (n, var) <- M.toList m]
        <> "}"
    go _ (SMap m) =
      "{"
        <> T.intercalate ", " [go True key <> ": " <> go True (getConst var) | (key, var) <- M.toList m]
        <> "}"
    go b (SContract _ address) = T.pack . bool id show b $ show address
    go _ (SVariadic xs) = "[" <> T.intercalate ", " (map (go True) xs) <> "]"
    go _ (SDecimal v) = T.pack $ show v
    go _ _ = "0"

instance ToJSON Variable where
  toJSON (Constant v) = toJSON v
  toJSON (Variable _) = toJSON SNULL
  toJSON (TypedVariable _ v) = toJSON v

instance FromJSON Variable where
  parseJSON v = Constant <$> parseJSON v

instance ToJSON Value where
  toJSON (SIntegral n) = object ["t" .= ("int" :: String), "v" .= show n]
  toJSON (SDecimal d) = object ["t" .= ("dec" :: String), "v" .= show d]
  toJSON (SString s) = object ["t" .= ("str" :: String), "v" .= s]
  toJSON (SBool b) = object ["t" .= ("bool" :: String), "v" .= b]
  toJSON (SAddress a p) = object ["t" .= ("addr" :: String), "v" .= show a, "p" .= p]
  toJSON (SEnumVal tn vn vi) = object ["t" .= ("enum" :: String), "tn" .= tn, "vn" .= vn, "vi" .= vi]
  toJSON (SStruct n vs) = object ["t" .= ("struct" :: String), "n" .= n, "v" .= M.map toJSON vs]
  toJSON (STuple items) = object ["t" .= ("tup" :: String), "v" .= map toJSON (V.toList items)]
  toJSON (SArray items) = object ["t" .= ("arr" :: String), "v" .= map toJSON (V.toList items)]
  toJSON (SContract n a) = object ["t" .= ("contract" :: String), "n" .= n, "v" .= show a]
  toJSON SNULL = toJSON ()
  toJSON (SBytes bs) = object ["t" .= ("bytes" :: String), "v" .= BC.unpack (B16.encode bs)]
  toJSON _ = toJSON ()

instance FromJSON Value where
  parseJSON (Aeson.Object o) = do
    t <- o .: "t"
    case (t :: String) of
      "int" -> SInteger . read <$> o .: "v"
      "dec" -> SDecimal . read <$> o .: "v"
      "str" -> SString <$> o .: "v"
      "bool" -> SBool <$> o .: "v"
      "addr" -> SAddress <$> (read <$> o .: "v") <*> o .:? "p" .!= False
      "enum" -> SEnumVal <$> o .: "tn" <*> o .: "vn" <*> o .: "vi"
      "struct" -> SStruct <$> o .: "n" <*> o .: "v"
      "tup" -> STuple . V.fromList <$> o .: "v"
      "arr" -> SArray . V.fromList <$> o .: "v"
      "contract" -> SContract <$> o .: "n" <*> (read <$> o .: "v")
      "bytes" -> do
        hex <- o .: "v"
        case B16.decode (BC.pack hex) of
          Right bs -> pure $ SBytes bs
          Left err -> fail $ "Invalid hex in bytes: " ++ err
      _ -> fail $ "Unknown Value tag: " ++ t
  parseJSON _ = pure SNULL

-- Binary instance for Value. Carries the same variants, with the same losses,
-- as the JSON instance: IORef-backed aggregates serialize as snapshots
-- ('Variable' becomes SNULL, 'Constant' its value), and variants the JSON
-- instance maps to () are SNULL. Everything else is a tag and the fields.
instance Binary.Binary Value where
  put v = case v of
    SUnsigned n -> tag 12 >> Binary.put (toInteger n)
    SIntegral n -> tag 0 >> Binary.put n
    SDecimal d -> tag 1 >> Binary.put (decimalPlaces d) >> Binary.put (decimalMantissa d)
    SString s -> tag 2 >> putUtf8String s
    SBool b -> tag 3 >> Binary.put b
    SAddress a p -> tag 4 >> Binary.put a >> Binary.put p
    SEnumVal tn vn vi -> tag 5 >> Binary.put tn >> Binary.put vn >> Binary.put vi
    SStruct n vs -> tag 6 >> Binary.put n >> Binary.put (M.map snapshot vs)
    STuple items -> tag 7 >> Binary.put (map snapshot (V.toList items))
    SArray items -> tag 8 >> Binary.put (map snapshot (V.toList items))
    SContract n a -> tag 9 >> Binary.put n >> Binary.put a
    SBytes bs -> tag 10 >> Binary.put bs
    _ -> tag 11
    where
      tag :: Word8 -> Binary.Put
      tag = Binary.put
      snapshot (Constant c) = c
      snapshot (Variable _) = SNULL
      snapshot (TypedVariable _ v') = snapshot v'
  get = do
    t <- Binary.get :: Binary.Get Word8
    case t of
      0 -> SInteger <$> Binary.get
      1 -> SDecimal <$> (Decimal <$> Binary.get <*> Binary.get)
      2 -> SString <$> getUtf8String
      3 -> SBool <$> Binary.get
      4 -> SAddress <$> Binary.get <*> Binary.get
      5 -> SEnumVal <$> Binary.get <*> Binary.get <*> Binary.get
      6 -> SStruct <$> Binary.get <*> (M.map Constant <$> Binary.get)
      7 -> STuple . V.fromList . map Constant <$> Binary.get
      8 -> SArray . V.fromList . map Constant <$> Binary.get
      9 -> SContract <$> Binary.get <*> Binary.get
      10 -> SBytes <$> Binary.get
      11 -> pure SNULL
      12 -> do
        n <- Binary.get
        if n < 0 then fail "negative unsigned integer" else pure (unsignedInteger n)
      _ -> fail $ "Unknown Value tag: " ++ show t
