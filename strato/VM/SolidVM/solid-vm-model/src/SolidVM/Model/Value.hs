{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module SolidVM.Model.Value
  ( Variable (..),
    Value (..),
    AddressPath (..),
    ValList,
    rlpEncodeVariable,
    rlpEncodeValue,
    rlpEncodeValues,
    createVar,
    coerceType,
    apSnoc,
    apSnocList,
    defaultValue,
    createDefaultValue,
    valEquals,
    valueTypeName,
  )
where

import Blockchain.Data.RLP
import Blockchain.SolidVM.Exception
import Blockchain.Strato.Model.Address
import qualified Data.ByteString.Char8 as BC
import Text.Format
import Control.Lens ((^.))
import Control.Monad (forM, when)
import Control.Monad.IO.Class
import Data.ByteString (ByteString)
import Data.Decimal
import Data.Foldable (asum)
import Data.IORef
import Data.Map (Map)
import qualified Data.Map as M
import Data.Maybe (fromMaybe, listToMaybe)
import Data.Vector (Vector)
import qualified Data.Vector as V
import Data.Word
import Numeric
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Storable as MS
import qualified SolidVM.Model.Type as SVMType
import Text.Printf

data AddressPath = AddressPath
  { apAddress :: Address,
    apPath :: MS.StoragePath
  }
  deriving (Eq)

apSnoc :: AddressPath -> MS.StoragePathPiece -> AddressPath
apSnoc (AddressPath loc path) piece = AddressPath loc $! path `MS.snoc` piece

apSnocList :: AddressPath -> [MS.StoragePathPiece] -> AddressPath
apSnocList (AddressPath loc path) pieces = AddressPath loc $! path `MS.snocList` pieces

instance Show AddressPath where
  show (AddressPath a p) = printf "%s//%s" (show a) (show p)

data Variable
  = Variable (IORef Value)
  | Constant Value
  deriving (Eq)

instance Show Variable where
  show (Variable _) = "<variable>"
  show (Constant v) = "Constant: " ++ show v

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
  | SReference AddressPath -- An alias to an existing variable, so that modifications
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
  deriving (Show)

--TODO- Remove this sloppy half-measure of Ord, Eq definitions once we move to Solidity static typing
--This only allows for comparison within the same type of values
--(the move to static typing will probably automatically clean this up)

instance Eq Value where
  SNULL == SNULL = True
  SReference{} == SReference{} = True
  (SInteger i1) == (SInteger i2) = i1 == i2
  SNULL == (SInteger i2) = 0 == i2
  (SInteger i1) == SNULL = i1 == 0
  SReference{} == (SInteger i2) = 0 == i2
  (SInteger i1) == SReference{} = i1 == 0
  (SString s1) == (SString s2) = s1 == s2
  SNULL == (SString s2) = "" == s2
  (SString s1) == SNULL = s1 == ""
  SReference{} == (SString s2) = "" == s2
  (SString s1) == SReference{} = s1 == ""
  (SDecimal v1) == (SDecimal v2) = v1 == v2
  SNULL == (SDecimal v2) = 0.0 == v2
  (SDecimal v1) == SNULL = v1 == 0.0
  SReference{} == (SDecimal v2) = 0.0 == v2
  (SDecimal v1) == SReference{} = v1 == 0.0
  (SBool b1) == (SBool b2) = b1 == b2
  SNULL == (SBool b2) = False == b2
  (SBool b1) == SNULL = b1 == False
  SReference{} == (SBool b2) = False == b2
  (SBool b1) == SReference{} = b1 == False
  (SAddress a1 b1) == (SAddress a2 b2) = (a1 == a2 && b1 == b2)
  SNULL == (SAddress a2 b2) = (0x0 == a2 && False == b2)
  (SAddress a1 b1) == SNULL = (a1 == 0x0 && b1 == False)
  SReference{} == (SAddress a2 b2) = (0x0 == a2 && False == b2)
  (SAddress a1 b1) == SReference{} = (a1 == 0x0 && b1 == False)
  (SContract c1 a1) == (SContract c2 a2) = c1 == c2 && a1 == a2
  SNULL == (SContract c2 a2) = "" == c2 && 0x0 == a2
  (SContract c1 a1) == SNULL = c1 == "" && a1 == 0x0
  SReference{} == (SContract c2 a2) = "" == c2 && 0x0 == a2
  (SContract c1 a1) == SReference{} = c1 == "" && a1 == 0x0
  (SEnumVal t1 _ n1) == (SEnumVal t2 _ n2) = t1 == t2 && n1 == n2
  SNULL == (SEnumVal _ _ n2) = 0 == n2
  (SEnumVal _ _ n1) == SNULL = n1 == 0
  SReference{} == (SEnumVal _ _ n2) = 0 == n2
  (SEnumVal _ _ n1) == SReference{} = n1 == 0
  x == y = todo "Value/Eq" (x, y)

instance Ord Value where
  compare SNULL SNULL = EQ
  compare (SInteger i1) (SInteger i2) = compare i1 i2
  compare SNULL (SInteger i2) = compare 0 i2
  compare (SInteger i1) SNULL = compare i1 0
  compare SReference{} (SInteger i2) = compare 0 i2
  compare (SInteger i1) SReference{} = compare i1 0
  compare (SString s1) (SString s2) = compare s1 s2
  compare SNULL (SString s2) = compare "" s2
  compare (SString s1) SNULL = compare s1 ""
  compare SReference{} (SString s2) = compare "" s2
  compare (SString s1) SReference{} = compare s1 ""
  compare (SDecimal v1) (SDecimal v2) = compare v1 v2
  compare SNULL (SDecimal v2) = compare 0.0 v2
  compare (SDecimal v1) SNULL = compare v1 0.0
  compare SReference{} (SDecimal v2) = compare 0.0 v2
  compare (SDecimal v1) SReference{} = compare v1 0.0
  compare (SBool b1) (SBool b2) = compare b1 b2
  compare SNULL (SBool b2) = compare False b2
  compare (SBool b1) SNULL = compare b1 False
  compare SReference{} (SBool b2) = compare False b2
  compare (SBool b1) SReference{} = compare b1 False
  compare (SAddress a1 _) (SAddress a2 _) = compare a1 a2
  compare SNULL (SAddress a2 _) = compare 0x0 a2
  compare (SAddress a1 _) SNULL = compare a1 0x0
  compare SReference{} (SAddress a2 _) = compare 0x0 a2
  compare (SAddress a1 _) SReference{} = compare a1 0x0
  compare x y = todo "Value/Ord" (x, y)

instance RLPSerializable Value where
  rlpEncode = rlpEncodeValue
  rlpDecode x = todo "Value/rlpDecode" x

rlpEncodeVariable :: Variable -> RLPObject
rlpEncodeVariable (Variable _) = rlpEncodeValue SNULL
rlpEncodeVariable (Constant v) = rlpEncodeValue v

rlpEncodeValue :: Value -> RLPObject
rlpEncodeValue SNULL = rlpEncodeValue $ SInteger 0
rlpEncodeValue SReference{} = rlpEncodeValue $ SInteger 0
rlpEncodeValue (SInteger i) = rlpEncode i
rlpEncodeValue (SString s) = rlpEncode s
rlpEncodeValue (SDecimal decimal) = rlpEncode $ show decimal
rlpEncodeValue (SBool b) = rlpEncode b
rlpEncodeValue (SAddress a _) = rlpEncode a
rlpEncodeValue (SEnumVal _ _ i) = rlpEncode i
rlpEncodeValue (SStruct _ m) = RLPArray $ rlpEncodeVariable . snd <$> M.toList m
rlpEncodeValue (STuple v) = RLPArray $ rlpEncodeVariable <$> V.toList v
rlpEncodeValue (SArray v) = RLPArray $ rlpEncodeVariable <$> V.toList v
rlpEncodeValue (SVariadic vs) = rlpEncodeValues vs
rlpEncodeValue _ = RLPArray []

rlpEncodeValues :: [Value] -> RLPObject
rlpEncodeValues [x] = rlpEncodeValue x
rlpEncodeValues xs = rlpEncodeValue $ STuple $ V.fromList $ Constant <$> xs

-- coerceFromInt is useful to force integer literals
-- to assume the type that was intended for them, once
-- it is determined that their expected type is
coerceFromInt :: CC.Contract -> Value -> Integer -> Value
coerceFromInt _ SInteger {} n = SInteger n
coerceFromInt _ (SAddress _ b) n = SAddress (fromIntegral n) b
coerceFromInt _ SBool {} n = SBool $ n /= 0
coerceFromInt _ SString {} 0 = SString ""
coerceFromInt _ SString {} n = SString $ showHex n ""
coerceFromInt _ SDecimal {} n = SDecimal $ Decimal 0 n
coerceFromInt _ (SContract c _) n = SContract c $ fromIntegral n
coerceFromInt ct (SEnumVal tipe _ _) n' =
  fromMaybe (typeError "missing enum val" $ show (tipe, n')) $ do
    let n = fromIntegral n'
    enumDef <- fmap fst . M.lookup tipe $ CC._enums ct
    when (n >= length enumDef) $ fail "enum val out of range"
    return $ SEnumVal tipe (enumDef !! n) $ fromIntegral n'
coerceFromInt _ SNULL n = SInteger n
coerceFromInt _ SReference{} n = SInteger n
coerceFromInt _ t x = typeError "coerceFromInt: invalid literal for type" $ show (t, x)

-- coerceType allows integer literals to initialize integers, addresses, and
-- strings (in the special case of 0) and bytes32, determined by type instead of value
coerceType :: CC.Contract -> SVMType.Type -> Value -> Value
coerceType ct xt = \case
  SInteger i -> coerceFromInt ct (defaultValue ct xt) i
  SString s -> case xt of
    SVMType.String {} -> SString s
    SVMType.Bytes {} -> SString s
    SVMType.Decimal {} -> SDecimal (read s :: Decimal)
    _ -> typeError "string literal must be string or bytes" $ show (xt, s)
  v -> v

valEquals :: CC.Contract -> Value -> Value -> Bool
valEquals ct lhs rhs = case (lhs, rhs) of
  (SInteger _, SInteger _) -> lhs == rhs
  (SInteger i, _) -> coerceFromInt ct rhs i == rhs
  (_, SInteger i) -> lhs == coerceFromInt ct lhs i
  _ -> lhs == rhs

createVar' :: MonadIO m => Value -> m Variable
createVar' val = liftIO $ Variable <$> newIORef val

toVar :: MonadIO m => Variable -> m Variable
toVar (Constant val) = createVar val
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
defaultValue _ (SVMType.Mapping _ _ _) = SMap M.empty
defaultValue _ (SVMType.Int _ _) = SInteger 0
defaultValue _ SVMType.Bool = SBool False
defaultValue _ (SVMType.Address _) = (SAddress 0) False
defaultValue _ (SVMType.String _) = SString ""
defaultValue _ (SVMType.Bytes _ _) = SString ""
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
defaultValue _ x = todo "defaultValue" x

createDefaultValue ::
  MonadIO m =>
  CC.CodeCollection ->
  CC.Contract ->
  SVMType.Type ->
  m Value
createDefaultValue _ _ (SVMType.Array _ _) = return $ SArray V.empty
createDefaultValue _ _ (SVMType.Mapping _ _ _) = return $ SMap M.empty
createDefaultValue _ _ (SVMType.Int _ _) = return $ SInteger 0
createDefaultValue _ _ SVMType.Bool = return $ SBool False
createDefaultValue _ _ (SVMType.Address _) = return $ (SAddress 0) False
createDefaultValue _ _ (SVMType.String _) = return $ SString ""
createDefaultValue _ _ (SVMType.Bytes _ _) = return $ SString ""
createDefaultValue _ _ SVMType.Decimal = return $ SDecimal 0
createDefaultValue cc ctract (SVMType.UnknownLabel name) =
  case (M.lookup name $ CC._enums ctract, M.lookup name $ CC._structs ctract) of
    (Just ((val : _), _), _) -> return $ SEnumVal name val 0x0
    (Nothing, Just sdef) -> do
      items <-
        forM sdef $ \(n, itemType, _) -> do
          itemVal <- createDefaultValue cc ctract $ CC.fieldTypeType itemType
          itemVar <- createVar itemVal
          return (n, itemVar)
      return $ SStruct name $ M.fromList items
    _ -> do
      case (M.lookup name $ cc ^. CC.flEnums, M.lookup name $ cc ^. CC.flStructs) of
        (Just ((val : _), _), _) -> return $ SEnumVal name val 0x0
        (Nothing, Just sdef) -> do
          items <-
            forM sdef $ \(n, itemType, _) -> do
              itemVal <- createDefaultValue cc ctract $ CC.fieldTypeType itemType
              itemVar <- createVar itemVal
              return (n, itemVar)
          return $ SStruct name $ M.fromList items
        _ -> return $ SContract name 0x0
createDefaultValue _ _ x = todo "createDefaultValue" x

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
valueTypeName (SInteger _) = "Integer"
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
  format (SReference (AddressPath addr path)) =
    "Reference(" ++ take 10 (show addr) ++ ".../" ++ BC.unpack (MS.unparsePath path) ++ ")"
  format (SInteger n) = "Integer(" ++ show n ++ ")"
  format (SBool b) = "Bool(" ++ show b ++ ")"
  format (SString s) = "String(" ++ show (take 20 s) ++ if length s > 20 then "...)" else ")"
  format (SAddress a _) = "Address(" ++ take 10 (show a) ++ "...)"
  format v = valueTypeName v
