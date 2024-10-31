{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module SolidVM.Model.Value
  ( Variable (..),
    Value (..),
    BasicType (..),
    AccountPath (..),
    Typo (..),
    ValList (..),
    IndexType (..),
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
import Blockchain.Strato.Model.ExtendedWord
import Control.Lens ((.~), (^.))
import Control.Monad (forM, when)
import Control.Monad.IO.Class
import Data.ByteString (ByteString)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
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
  { apAccount :: Account,
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

-- Util functions to help display variables within the IO monad, since it reads from an IO ref to get the variable's value
-- Uncomment when needed
-- showVariable :: MonadIO m => Variable -> m String
-- showVariable (Variable v) = do
--   val <- liftIO $ readIORef v
--   showValue val
-- showVariable (Constant c) = showValue c

-- showValue :: MonadIO m => Value -> m String
-- Only implemented useful show for Arrays, as they are the most commonly used values that use IORefs
-- showValue (SArray _ vc) = do
--   ss <- mapM showVariable vc
--   let s :: String
--       s = foldl insertComma "SArray: " ss
--   return s
-- showValue v = return $ show v

-- insertComma :: String -> String -> String
-- insertComma a b = a ++ ", " ++ b
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
  | SArray SVMType.Type (Vector Variable)
  | SMap SVMType.Type (Map Value Variable)
  | SFunction SolidString CC.Func
  | SBuiltinFunction SolidString (Maybe Value)
  | SBuiltinVariable SolidString
  | SSetterGetter String (Maybe Value)
  | SContractDef SolidString
  | -- | SBuiltinTypeF SolidString SolidString CodeCollection
    SContractItem NamedAccount SolidString
  | SContract SolidString NamedAccount
  | SContractFunction (Maybe SolidString) NamedAccount SolidString -- contractName, address, functionName
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
  | SMappingSentinel
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

-- coerceFromInt is useful to force integer literals
-- to assume the type that was intended for them, once
-- it is determined that their expected type is
coerceFromInt :: CC.Contract -> Value -> Integer -> Value
coerceFromInt _ SInteger {} n = SInteger n
coerceFromInt _ (SAccount a b) n = (SAccount $ (namedAccountAddress .~ fromIntegral n) a) b
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
coerceFromInt _ t x = typeError "coerceFromInt: invalid literal for type" (t, x)

-- coerceType allows integer literals to initialize integers, addresses, and
-- strings (in the special case of 0) and bytes32, determined by type instead of value
coerceType :: CC.Contract -> SVMType.Type -> Value -> Value
coerceType ct xt = \case
  SInteger i -> coerceFromInt ct (defaultValue ct xt) i
  SString s -> case xt of
    SVMType.String {} -> SString s
    SVMType.Bytes {} -> case B16.decode (BC.pack s) of
      Right bs -> SString . BC.unpack $ B.takeWhile (/= 0) bs
      _ -> SString s
    SVMType.Decimal {} -> SDecimal (read s :: Decimal)
    _ -> typeError "string literal must be string or bytes" (xt, s)
  v -> v

valEquals :: Maybe Word256 -> CC.Contract -> Value -> Value -> Bool
valEquals chainId ct lhs rhs = case (lhs, rhs) of
  (SInteger i, _) -> coerceFromInt ct rhs i == rhs
  (_, SInteger i) -> coerceFromInt ct lhs i == lhs
  (SBool s1, SBool s2) -> s1 == s2
  (SString s1, SString s2) -> s1 == s2
  (SDecimal v1, SDecimal v2) -> v1 == v2
  (SAccount v1 b1, SAccount v2 b2) -> namedAccountToAccount chainId v1 == namedAccountToAccount chainId v2 && b1 == b2
  (SEnumVal e1 _ n1, SEnumVal e2 _ n2) -> e1 == e2 && n1 == n2
  (SContract _ a1, SAccount a2 _) -> namedAccountToAccount chainId a1 == namedAccountToAccount chainId a2
  (SAccount a1 _, SContract _ a2) -> namedAccountToAccount chainId a1 == namedAccountToAccount chainId a2
  (SContract _ a1, SContract _ a2) -> namedAccountToAccount chainId a1 == namedAccountToAccount chainId a2
  (SBuiltinVariable v1, SBuiltinVariable v2) ->
    todo "comparison of builtin vars requires evaluation: " (v1, v2)
  _ -> todo "unsupported type combination in valEquals: " (lhs, rhs)

createVar :: MonadIO m => Value -> m Variable
createVar val = liftIO $ fmap Variable $ newIORef val

--TODO- defaultValue is deprecated, will be removed...  Instead use createDefaultValue
defaultValue :: CC.Contract -> SVMType.Type -> Value
defaultValue _ (SVMType.Array valType _) = SArray valType V.empty
defaultValue _ (SVMType.Mapping _ _ valType) = SMap valType $ M.empty
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
defaultValue _ x = todo "defaultValue" x

createDefaultValue ::
  MonadIO m =>
  CC.CodeCollection ->
  CC.Contract ->
  SVMType.Type ->
  m Value
createDefaultValue _ _ (SVMType.Array valType _) = return $ SArray valType V.empty
createDefaultValue _ _ (SVMType.Mapping _ _ valType) = return $ SMap valType $ M.empty
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
  | TComplex
  | Todo String
  deriving (Show, Eq)

-- Evaluated ArgLists
data ValList
  = OrderedVals [Value]
  | NamedVals [(SolidString, Value)]
  deriving (Show, Eq)
