{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.SolidVM.Value where


import           Data.ByteString (ByteString)
import qualified Data.ByteString as B
import           Data.IORef
import           Data.Map (Map)
import qualified Data.Map as M
import           Data.Vector (Vector)
import qualified Data.Vector as V
import qualified Data.Text as T
import           Numeric
import           Text.Printf

import           Blockchain.Data.Address
import           Blockchain.Data.RLP
import           Blockchain.SolidVM.Exception

import qualified SolidVM.Model.Storable           as MS
import qualified SolidVM.Solidity.Xabi            as Xabi
import qualified SolidVM.Solidity.Xabi.Type       as Xabi
import qualified SolidVM.Solidity.Xabi.VarDef     as Xabi



data IndexType = ArrayIndex | MapBoolIndex | MapAddressIndex | MapIntIndex | MapStringIndex deriving (Show, Eq)

data LocalVar = LocalVar deriving (Show, Eq)


data AddressedPath = AddressedPath
  { apAddress :: Either LocalVar Address
  , apPath :: MS.StoragePath
  } deriving (Eq)

apSnoc :: AddressedPath -> MS.StoragePathPiece -> AddressedPath
apSnoc (AddressedPath loc path) piece = AddressedPath loc $! path `MS.snoc` piece


instance Show AddressedPath where
  show (AddressedPath a p) = printf "%s//%s" (show a) (show p)

data Variable = Variable (IORef Value)
  | Constant Value
  | StorageItem AddressedPath

instance Show Variable where
  show (Variable _) = "<variable>"
  show (Constant v) = "Constant: " ++ show v
  show (StorageItem ap) = printf "<storage %s>" (show ap)

--TODO- we need to figure out this ambiguity on the Address types....
--Sometimes address is and integer (solidity can treat an integer as an address),
--sometimes it is a proper type.

data Value =
  SInteger Integer
  | SString String
  | SBool Bool
  | SAddress Address
  | SEnum String
  | SEnumVal String String
  | SStructDef String
  | SStruct String (Map String Variable)
  | STuple (Vector Variable)
  | SArray Xabi.Type (Vector Variable)
  | SMap Xabi.Type (Map Value Variable)
  | SFunction Xabi.Func
  | SBuiltinFunction String (Maybe Value)
  | SBuiltinVariable String
  | SSetterGetter String (Maybe Value)
  | SContractDef String
  | SContractItem Address String
  | SContract String Address
  | SContractFunction String Address String -- contractName, address, functionName
  | SPush AddressedPath -- The array function
  | SNULL
  | SReference AddressedPath  -- An alias to an existing variable, so that modifications
                              -- can be canonicalized
  | SHexDecodeAndTrim -- Hack to implement blockapps-sol's bytes32ToString without
                      -- supporting indexing into bytes32s.
  | SMappingSentinel
  deriving (Show)

--TODO- Remove this sloppy half-measure of Ord, Eq definitions once we move to Solidity static typing
--This only allows for comparison within the same type of values
--(the move to static typing will probably automatically clean this up)

instance Eq Value where
  (SInteger i1) == (SInteger i2) = i1 == i2
  (SString s1) == (SString s2) = s1 == s2
  (SBool b1) == (SBool b2) = b1 == b2
  (SAddress a1) == (SAddress a2) = a1 == a2
  x == y = todo "Value/Eq" (x, y)

instance Ord Value where
  compare (SInteger i1) (SInteger i2) = compare i1 i2
  compare (SString s1) (SString s2) = compare s1 s2
  compare (SBool b1) (SBool b2) = compare b1 b2
  compare (SAddress a1) (SAddress a2) = compare a1 a2
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
coerceFromInt:: Value -> Integer -> Value
coerceFromInt SInteger{} n = SInteger n
coerceFromInt SAddress{} n = SAddress $ fromIntegral n
coerceFromInt SString{} 0 = SString ""
coerceFromInt SString{} n = SString $ showHex n ""
coerceFromInt t x = typeError "invalid literal for type" (t, x)

-- coerceType allows integer literals to initialize integers, addresses, and
-- strings (in the special case of 0) and bytes32, determined by type instead of value
coerceType :: Xabi.Type -> Value -> Value
coerceType xt = \case
    SInteger i -> coerceFromInt (defaultValue xt) i
    v -> v


valEquals :: Value -> Value -> Bool
valEquals lhs rhs = case (lhs, rhs) of
  (SInteger i, _) -> coerceFromInt rhs i == rhs
  (_, SInteger i) -> coerceFromInt lhs i == lhs
  (SString s1, SString s2) -> s1 == s2
  (SAddress v1, SAddress v2) -> v1 == v2
  (SEnumVal e1 v1, SEnumVal e2 v2) -> (e1 == e2) && (v1 == v2)
  (SBuiltinVariable v1, SBuiltinVariable v2) ->
    todo "comparison of builtin vars requires evaluation: " (v1, v2)
  _ -> todo "unsupported type combination in valEquals: " (lhs, rhs)



defaultValue :: Xabi.Type -> Value
defaultValue (Xabi.Array valType _) = SArray valType V.empty
defaultValue (Xabi.Mapping _ _ valType) = SMap valType $ M.empty
defaultValue (Xabi.Int _ _) = SInteger 0
defaultValue Xabi.Bool = SBool False
defaultValue (Xabi.Address) = SAddress $ Address 0
defaultValue (Xabi.String _) = SString ""
defaultValue (Xabi.Bytes _ _) = SString ""
-- TODO: The label could also be an enum or a struct
defaultValue (Xabi.Label name) = SContract name 0x0
defaultValue x = todo "defaultValue" x





byteStringToValue :: ByteString -> Maybe Value
byteStringToValue x | x == B.singleton 128 = Nothing
byteStringToValue x = Just . SInteger . rlpDecode . rlpDeserialize $ x

castToInt :: Value -> Integer
castToInt (SInteger i) = i
castToInt s = typeError "castToInt" s


-- Typos are the possible values that a Xabi.Label
-- is able to resolve to
data Typo = StructTypo [(T.Text, Xabi.FieldType)]
          | EnumTypo [String]
          | ContractTypo String
          deriving (Show)

-- BasicTypes are approximately what can be stored, but more exactly
-- they are types which have an `operator=` in the parlance of C++.
-- Even though structs cannot be stored directly, the operator=
-- simulates their appearance by retrieving theh individual fields.
data BasicType = TInteger | TString | TBool | TAddress
               | TEnumVal String | TContract String
               | TStruct String [(B.ByteString, BasicType)]
               | TComplex
               | Todo String
               deriving (Show, Eq)
