{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module SolidVM.Model.Value
  ( Variable (..),
    Value (..),
    BasicType (..),
    AccountPath (..),
    Typo (..),
    ValList,
    IndexType (..),
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
  )
where

import Blockchain.Data.RLP
import Blockchain.SolidVM.Exception
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Control.Lens ((.~), (^.))
import Control.Monad (forM, when)
import Control.Monad.IO.Class
import Data.ByteString (ByteString)
import qualified Data.ByteString as B
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

data IndexType = ArrayIndex | MapBoolIndex | MapAccountIndex | MapIntIndex | MapStringIndex deriving (Show, Eq)

data AccountPath = AccountPath
  { apAccount :: Address,
    apPath :: MS.StoragePath
  }
  deriving (Eq)

apSnoc :: AccountPath -> MS.StoragePathPiece -> AccountPath
apSnoc (AccountPath loc path) piece = AccountPath loc $! path `MS.snoc` piece

apSnocList :: AccountPath -> [MS.StoragePathPiece] -> AccountPath
apSnocList (AccountPath loc path) pieces = AccountPath loc $! path `MS.snocList` pieces

instance Show AccountPath where
  show (AccountPath a p) = printf "%s//%s" (show a) (show p)

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
  | SAccount NamedAccount Bool --isPayable
  | SUserDefined SolidString SolidString Value
  | -- This is a payable account, which means it can use .transfer() , .send() , .call() , .delegatecall() and .staticcall()
    SEnum SolidString
  | SEnumVal SolidString SolidString Word32
  | SStructDef SolidString
  | SStruct SolidString (Map SolidString Variable)
  | STuple (Vector Variable)
  | SArray (Vector Variable)
  | SMap (Map Value Variable)
  | SFunction SolidString (Maybe CC.Func) -- Nothing means it's a builtin function
  | SBuiltinVariable SolidString
  | SSetterGetter String (Maybe Value)
  | SContractDef SolidString
  | -- | SBuiltinTypeF SolidString SolidString CodeCollection
    SContractItem NamedAccount SolidString
  | SContract SolidString NamedAccount
  | SContractFunction NamedAccount SolidString -- address, functionName
  | SPush Value (Maybe Variable) -- The array function
  | -- | SSend Value (Maybe Variable)
    -- | STransfer Value (Maybe Variable)
    -- | SDelegateCall Value (Maybe Variable)
    -- | SStaticCall Value (Maybe Variable)
    -- | SCall Value (Maybe Variable)
    SNULL
  | SReference AccountPath -- An alias to an existing variable, so that modifications
  -- can be canonicalized
  | SHexDecodeAndTrim -- Hack to implement blockapps-sol's bytes32ToString without
  -- supporting indexing into bytes32s.
  | SStringConcat -- for easy concat of multiple arguments
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
  (SInteger i1) == (SInteger i2) = i1 == i2
  (SString s1) == (SString s2) = s1 == s2
  (SDecimal v1) == (SDecimal v2) = v1 == v2
  (SBool b1) == (SBool b2) = b1 == b2
  (SAccount a1 b1) == (SAccount a2 b2) = (a1 == a2 && b1 == b2)
  (SContract c1 a1) == (SContract c2 a2) = c1 == c2 && a1 == a2
  (SEnumVal t1 _ n1) == (SEnumVal t2 _ n2) = t1 == t2 && n1 == n2
  x == y = todo "Value/Eq" (x, y)

instance Ord Value where
  compare (SInteger i1) (SInteger i2) = compare i1 i2
  compare (SString s1) (SString s2) = compare s1 s2
  compare (SDecimal v1) (SDecimal v2) = compare v1 v2
  compare (SBool b1) (SBool b2) = compare b1 b2
  compare (SAccount a1 _) (SAccount a2 _) = compare a1 a2
  compare x y = todo "Value/Ord" (x, y)

instance RLPSerializable Value where
  rlpEncode (SInteger i) = RLPArray [RLPString "I", rlpEncode i]
  rlpEncode (SString s) = RLPArray [RLPString "S", rlpEncode s]
  rlpEncode x = todo "Value/rlpEncode" x

  rlpDecode (RLPArray [RLPString "I", i]) = SInteger $ rlpDecode i
  rlpDecode (RLPArray [RLPString "S", s]) = SString $ rlpDecode s
  rlpDecode x = todo "Value/rlpDecode" x

rlpEncodeVariable :: MonadIO m => Variable -> m RLPObject
rlpEncodeVariable (Variable r) = rlpEncodeValue =<< liftIO (readIORef r)
rlpEncodeVariable (Constant v) = rlpEncodeValue v

rlpEncodeValue :: MonadIO m => Value -> m RLPObject
rlpEncodeValue (SInteger i) = pure $ rlpEncode i
rlpEncodeValue (SString s) = pure $ rlpEncode s
rlpEncodeValue (SDecimal decimal) = pure $ rlpEncode $ show decimal
rlpEncodeValue (SBool b) = pure $ rlpEncode b
rlpEncodeValue (SAccount a _) = pure $ rlpEncode a
rlpEncodeValue (SEnumVal _ _ i) = pure $ rlpEncode i
rlpEncodeValue (SStruct _ m) = RLPArray <$> traverse (rlpEncodeVariable . snd) (M.toList m)
rlpEncodeValue (STuple v) = RLPArray <$> traverse rlpEncodeVariable (V.toList v)
rlpEncodeValue (SArray v) = RLPArray <$> traverse rlpEncodeVariable (V.toList v)
rlpEncodeValue (SVariadic vs) = RLPArray <$> traverse rlpEncodeValue vs
rlpEncodeValue _ = pure $ RLPArray []

rlpEncodeValues :: MonadIO m => [Value] -> m RLPObject
rlpEncodeValues [x] = rlpEncodeValue x
rlpEncodeValues xs = rlpEncodeValue $ STuple $ V.fromList $ Constant <$> xs

-- coerceFromInt is useful to force integer literals
-- to assume the type that was intended for them, once
-- it is determined that their expected type is
coerceFromInt :: CC.Contract -> Value -> Integer -> Value
coerceFromInt _ SInteger {} n = SInteger n
coerceFromInt _ (SAccount a b) n = (SAccount $ (namedAccountAddress .~ fromIntegral n) a) b
coerceFromInt _ SBool {} n = SBool $ n /= 0
coerceFromInt _ SString {} 0 = SString ""
coerceFromInt _ SString {} n = SString $ showHex n ""
coerceFromInt _ SDecimal {} n = SDecimal $ Decimal 0 n
coerceFromInt _ (SContract c a) n = SContract c $ (namedAccountAddress .~ fromIntegral n) a
coerceFromInt ct (SEnumVal tipe _ _) n' =
  fromMaybe (typeError "missing enum val" (tipe, n')) $ do
    let n = fromIntegral n'
    enumDef <- fmap fst . M.lookup tipe $ CC._enums ct
    when (n >= length enumDef) $ fail "enum val out of range"
    return $ SEnumVal tipe (enumDef !! n) $ fromIntegral n'
coerceFromInt _ SNULL n = if n == 0 then SNULL else SInteger n
coerceFromInt _ t x = typeError "coerceFromInt: invalid literal for type" (t, x)

-- coerceType allows integer literals to initialize integers, addresses, and
-- strings (in the special case of 0) and bytes32, determined by type instead of value
coerceType :: CC.Contract -> SVMType.Type -> Value -> Value
coerceType ct xt = \case
  SInteger i -> coerceFromInt ct (defaultValue ct xt) i
  SString s -> case xt of
    SVMType.String {} -> SString s
    SVMType.Bytes {} -> SString s
    SVMType.Decimal {} -> SDecimal (read s :: Decimal)
    _ -> typeError "string literal must be string or bytes" (xt, s)
  v -> v

valEquals :: CC.Contract -> Value -> Value -> Bool
valEquals ct lhs rhs = case (lhs, rhs) of
  (SInteger i, _) -> coerceFromInt ct rhs i == rhs
  (_, SInteger i) -> coerceFromInt ct lhs i == lhs
  (SBool s1, SBool s2) -> s1 == s2
  (SString s1, SString s2) -> s1 == s2
  (SDecimal v1, SDecimal v2) -> v1 == v2
  (SAccount v1 b1, SAccount v2 b2) -> v1 == v2 && b1 == b2
  (SEnumVal e1 _ n1, SEnumVal e2 _ n2) -> e1 == e2 && n1 == n2
  (SContract _ a1, SAccount a2 _) -> a1 == a2
  (SAccount a1 _, SContract _ a2) -> a1 == a2
  (SContract _ a1, SContract _ a2) -> a1 == a2
  (SBuiltinVariable v1, SBuiltinVariable v2) ->
    todo "comparison of builtin vars requires evaluation: " (v1, v2)
  _ -> todo "unsupported type combination in valEquals: " (lhs, rhs)

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
defaultValue _ (SVMType.Address _) = (SAccount $ unspecifiedChain (Address 0)) False
defaultValue _ (SVMType.Account _) = (SAccount $ unspecifiedChain (Address 0)) False
defaultValue _ (SVMType.String _) = SString ""
defaultValue _ (SVMType.Bytes _ _) = SString ""
defaultValue _ SVMType.Decimal = SDecimal 0
defaultValue ctract (SVMType.UnknownLabel name _) =
  fromMaybe (SContract name $ unspecifiedChain 0x0) $
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
createDefaultValue _ _ (SVMType.Address _) = return $ (SAccount $ unspecifiedChain (Address 0)) False
createDefaultValue _ _ (SVMType.Account _) = return $ (SAccount $ unspecifiedChain (Address 0)) False
createDefaultValue _ _ (SVMType.String _) = return $ SString ""
createDefaultValue _ _ (SVMType.Bytes _ _) = return $ SString ""
createDefaultValue _ _ SVMType.Decimal = return $ SDecimal 0
createDefaultValue cc ctract (SVMType.UnknownLabel name _) =
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
        _ -> return $ SContract name (unspecifiedChain 0x0)
createDefaultValue _ _ x = todo "createDefaultValue" x

{-
byteStringToValue :: B.ByteString -> Maybe Value
byteStringToValue x | x == B.singleton 128 = Nothing
byteStringToValue x = Just . SInteger . rlpDecode . rlpDeserialize $ x

castToInt :: Value -> Integer
castToInt (SInteger i) = i
castToInt s = typeError "castToInt" s
-}

-- Typos are the possible values that a CC.UnknownLabel
-- is able to resolve to
data Typo
  = StructTypo [(SolidString, CC.FieldType)]
  | EnumTypo [SolidString]
  | ContractTypo SolidString
  deriving (Show)

-- BasicTypes are approximately what can be stored, but more exactly
-- they are types which have an `operator=` in the parlance of C++.
-- Even though structs cannot be stored directly, the operator=
-- simulates their appearance by retrieving theh individual fields.
data BasicType
  = TInteger
  | TString
  | TDecimal
  | TBool
  | TAccount
  | TEnumVal SolidString
  | TContract SolidString
  | TStruct SolidString [(B.ByteString, BasicType)]
  | TArray BasicType (Maybe Word)
  | TMapping
  | Todo String
  deriving (Show, Eq)

-- Evaluated ArgLists
type ValList = [Value]
