{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans       #-}
{-# LANGUAGE FlexibleInstances #-}

module SolidityStateTypes where

import qualified Data.Map as Map
import qualified Data.Vector as VV
import Data.Binary as BN

import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import qualified Data.ByteString.Base16 as B16

import GHC.Generics

import Numeric.Natural

import Data.LargeWord

import Blockchain.Ethereum.Solidity.Parse
import Blockchain.Ethereum.Solidity.Layout hiding (StorageKey)

import qualified Data.Text as T
import qualified Data.Text.Encoding as T

import Data.Aeson

{-
  For us, the distinction between primitive types and complex types is essentially kindedness.

  Primitive types take values - complex types are make newtypes out of primitive types. Functionally,
  the distinction is nearly equivalent to that of value types and reference types - but we've grouped
  FixedSizeArrays under complex types rather than primitive types because of the kindedness at work.
-}

type StorageKey = Word256

-- StorageValues are vectors as we have to index arbitrary locations in them

type StorageValue = VV.Vector Word8

{-
  FlattenedStorageValue plays a dual role. If it spans a SingleKey, it is expected to
  have been truncated for the appropriate size of the target variable in Solidity.

  ManyKeys are lists of entire records returned by Array structures and the like, but we know that the data is stored lower order aligned (at least in the primitive type case), so can subsequently extract the values.
-}

data FlattenedStorageValue = SingleKey { unKey :: StorageValue }
                           | ManyKeys { unKeys :: [StorageValue] }
                          deriving (Show, Read, Eq)
type RawAddress = Word160

deriving instance Ord SolidityObjDef
deriving instance Ord SolidityObjLayout
deriving instance Ord SolidityTuple
deriving instance Ord SolidityBasicType

deriving instance Read SolidityObjDef
deriving instance Read SolidityObjLayout
deriving instance Read SolidityTuple
deriving instance Read SolidityBasicType

deriving instance Read Word256
deriving instance Read Word224
deriving instance Read Word192
deriving instance Read Word160
deriving instance Read Word128
deriving instance Read Word96

deriving instance Read Word24
deriving instance Read Word40

deriving instance Read Word48
deriving instance Read Word56

deriving instance Read Word72
deriving instance Read Word80
deriving instance Read Word88

deriving instance Read Word104
deriving instance Read Word112
deriving instance Read Word120

deriving instance Read Word136
deriving instance Read Word144
deriving instance Read Word152

deriving instance Read Word168
deriving instance Read Word176
deriving instance Read Word184

deriving instance Read Word200
deriving instance Read Word208
deriving instance Read Word216

deriving instance Read Word232
deriving instance Read Word240
deriving instance Read Word248

type Word24 = LargeKey Word16 Word8

type Word40 = LargeKey Word32 Word8
type Word48 = LargeKey Word32 Word16
type Word56 = LargeKey Word32 Word24

type Word72 = LargeKey Word64 Word8
type Word80 = LargeKey Word64 Word16
type Word88 = LargeKey Word64 Word24

type Word104 = LargeKey Word96 Word8
type Word112 = LargeKey Word96 Word16
type Word120 = LargeKey Word96 Word24

type Word136 = LargeKey Word128 Word8
type Word144 = LargeKey Word128 Word16
type Word152 = LargeKey Word128 Word24

type Word168 = LargeKey Word160 Word8
type Word176 = LargeKey Word160 Word16
type Word184 = LargeKey Word160 Word24

type Word200 = LargeKey Word192 Word8
type Word208 = LargeKey Word192 Word16
type Word216 = LargeKey Word192 Word24

type Word232 = LargeKey Word224 Word8
type Word240 = LargeKey Word224 Word16
type Word248 = LargeKey Word224 Word24

data SolidityStateVariable =
  PrimitiveVariable {
    primVar :: PrimitiveStateVariable
  } |
  ComplexVariable {
    complexVar :: ComplexStateVariable
  } deriving (Show, Eq, Ord, Generic)

data PrimitiveStateVariable =
  PrimitiveStateVariable {
    primObjDef :: SolidityObjDef
  , primObjLayout :: SolidityObjLayout
  , primVarContractName :: ContractName
  , primVarContractAddress :: Maybe RawAddress
  } deriving (Show, Eq, Ord, Generic)

data ComplexStateVariable =
  ComplexStateVariable {
    cplxObjDef :: SolidityObjDef
  , cplxObjLayout :: SolidityObjLayout
  , cplxVarContractName :: ContractName
  , cplxVarContractAddress :: Maybe RawAddress
  } deriving (Show, Read, Eq, Ord)

type VariableLength = Int


vector2Int :: Vector8 -> Integer
vector2Int = BN.decode . BL.pack . VV.toList

vector2UInt :: Vector8 -> Natural
vector2UInt = BN.decode . BL.pack . VV.toList

vector2Word256 :: Vector8 -> Word256
vector2Word256 = BN.decode . BL.pack . VV.toList

vector2Word8 :: Vector8 -> Word8
vector2Word8 = BN.decode . BL.pack . VV.toList

vector2Word16 :: Vector8 -> Word16
vector2Word16 = BN.decode . BL.pack . VV.toList

vector2Word24 :: Vector8 -> Word24
vector2Word24 = BN.decode . BL.pack . VV.toList

vector2Word32 :: Vector8 -> Word32
vector2Word32 = BN.decode . BL.pack . VV.toList

vector2Word40 :: Vector8 -> Word40
vector2Word40 = BN.decode . BL.pack . VV.toList

vector2Word48 :: Vector8 -> Word48
vector2Word48 = BN.decode . BL.pack . VV.toList

vector2Word56 :: Vector8 -> Word56
vector2Word56 = BN.decode . BL.pack . VV.toList

vector2Word64 :: Vector8 -> Word64
vector2Word64 = BN.decode . BL.pack . VV.toList

vector2Word72 :: Vector8 -> Word72
vector2Word72 = BN.decode . BL.pack . VV.toList

vector2Word80 :: Vector8 -> Word80
vector2Word80 = BN.decode . BL.pack . VV.toList

vector2Word88 :: Vector8 -> Word88
vector2Word88 = BN.decode . BL.pack . VV.toList

vector2Word96 :: Vector8 -> Word96
vector2Word96 = BN.decode . BL.pack . VV.toList

vector2Word104 :: Vector8 -> Word104
vector2Word104 = BN.decode . BL.pack . VV.toList

vector2Word112 :: Vector8 -> Word112
vector2Word112 = BN.decode . BL.pack . VV.toList

vector2Word120:: Vector8 -> Word120
vector2Word120 = BN.decode . BL.pack . VV.toList

vector2Word128 :: Vector8 -> Word128
vector2Word128 = BN.decode . BL.pack . VV.toList

vector2Word136 :: Vector8 -> Word136
vector2Word136 = BN.decode . BL.pack . VV.toList

vector2Word144 :: Vector8 -> Word144
vector2Word144 = BN.decode . BL.pack . VV.toList

vector2Word152 :: Vector8 -> Word152
vector2Word152 = BN.decode . BL.pack . VV.toList

vector2Word160 :: Vector8 -> Word160
vector2Word160 = BN.decode . BL.pack . VV.toList

vector2Word168 :: Vector8 -> Word168
vector2Word168 = BN.decode . BL.pack . VV.toList

vector2Word176 :: Vector8 -> Word176
vector2Word176 = BN.decode . BL.pack . VV.toList

vector2Word184 :: Vector8 -> Word184
vector2Word184 = BN.decode . BL.pack . VV.toList

vector2Word192 :: Vector8 -> Word192
vector2Word192 = BN.decode . BL.pack . VV.toList

vector2Word200 :: Vector8 -> Word200
vector2Word200 = BN.decode . BL.pack . VV.toList

vector2Word208 :: Vector8 -> Word208
vector2Word208 = BN.decode . BL.pack . VV.toList

vector2Word216 :: Vector8 -> Word216
vector2Word216 = BN.decode . BL.pack . VV.toList

vector2Word224 :: Vector8 -> Word224
vector2Word224 = BN.decode . BL.pack . VV.toList

vector2Word232 :: Vector8 -> Word232
vector2Word232 = BN.decode . BL.pack . VV.toList

vector2Word240 :: Vector8 -> Word240
vector2Word240 = BN.decode . BL.pack . VV.toList

vector2Word248 :: Vector8 -> Word248
vector2Word248 = BN.decode . BL.pack . VV.toList

type StartIndex = Natural
type EndIndex = Natural

type StartKey = StorageKey
type EndKey = StorageKey

maxByteIndex :: Natural
maxByteIndex = 32

{- for JSON representation -}

varName :: SolidityStateVariable -> String
varName (PrimitiveVariable sv) = objName . primObjDef $ sv
varName (ComplexVariable _) = error "complex variables not yet implemented"

varValue :: SolidityStateValue -> Value
varValue (PrimitiveValue (Bytes bv)) = Data.Aeson.String . T.decodeUtf8 . B16.encode . B.pack . VV.toList . bytes2Vec8 $ bv
varValue (PrimitiveValue (AddressBytes (Bytes20 addr))) = Data.Aeson.String . T.decodeUtf8 . B16.encode . B.pack . VV.toList $ addr
varValue (PrimitiveValue (SolBool b)) = Data.Aeson.Bool b
varValue (PrimitiveValue (SolInt i)) = Data.Aeson.String . T.pack . show $ i
varValue (PrimitiveValue (SolUInt u)) = Data.Aeson.String . T.pack . show $ u
varValue (ComplexValue (FixedSizeArray _ vals)) = Data.Aeson.Array $ VV.map (varValue . PrimitiveValue) vals
varValue _ = error "undefined var value"

data SolidityStateValue = PrimitiveValue { unPrimitive :: PrimitiveStateValue }
                        | ComplexValue { unComplex :: ComplexStateValue }
                       deriving (Show, Eq)

type ArraySize = Natural
type PrimitiveStateValues = VV.Vector PrimitiveStateValue

data PrimitiveStateValue = Bytes { unBytes :: BytesSized }
                         | SolInt { unInt :: IntSized }
                         | SolUInt { unUInt :: UIntSized }
                         | AddressBytes { unAddress :: BytesSized }
                         | SolBool { unBool :: Bool }
                        deriving (Show, Read, Eq)

data ComplexStateValue = FixedSizeArray { unSize :: ArraySize, unFixedValues :: PrimitiveStateValues }
                       | DynamicSizeArray { unCurrentSize :: ArraySize, unDynamicValues :: PrimitiveStateValues }
                       | Mapping { unMappingValues :: Map.Map StorageKey StorageValue }
                       | Struct { unStruct :: Map.Map PrimitiveStateVariable PrimitiveStateValue } -- not nestable for now
                      deriving (Show, Eq)


type Vector8 = VV.Vector Word8

bytes2Vec8 :: BytesSized -> Vector8
bytes2Vec8 bs =
  case bs of
    Bytes1 v -> v
    Bytes2 v -> v
    Bytes3 v -> v
    Bytes4 v -> v
    Bytes5 v -> v
    Bytes6 v -> v
    Bytes7 v -> v

    Bytes8 v -> v
    Bytes9 v -> v
    Bytes10 v -> v
    Bytes11 v -> v
    Bytes12 v -> v
    Bytes13 v -> v
    Bytes14 v -> v
    Bytes15 v -> v
    Bytes16 v -> v
    Bytes17 v -> v
    Bytes18 v -> v
    Bytes19 v -> v
    Bytes20 v -> v
    Bytes21 v -> v
    Bytes22 v -> v
    Bytes23 v -> v
    Bytes24 v -> v
    Bytes25 v -> v
    Bytes26 v -> v
    Bytes27 v -> v
    Bytes28 v -> v
    Bytes29 v -> v
    Bytes30 v -> v
    Bytes31 v -> v
    Bytes32 v -> v

data BytesSized = Bytes1 Vector8
                | Bytes2 Vector8
                | Bytes3 Vector8
                | Bytes4 Vector8
                | Bytes5 Vector8
                | Bytes6 Vector8
                | Bytes7 Vector8
                | Bytes8 Vector8
                | Bytes9 Vector8
                | Bytes10 Vector8
                | Bytes11 Vector8
                | Bytes12 Vector8
                | Bytes13 Vector8
                | Bytes14 Vector8
                | Bytes15 Vector8
                | Bytes16 Vector8
                | Bytes17 Vector8
                | Bytes18 Vector8
                | Bytes19 Vector8
                | Bytes20 Vector8
                | Bytes21 Vector8
                | Bytes22 Vector8
                | Bytes23 Vector8
                | Bytes24 Vector8
                | Bytes25 Vector8
                | Bytes26 Vector8
                | Bytes27 Vector8
                | Bytes28 Vector8
                | Bytes29 Vector8
                | Bytes30 Vector8
                | Bytes31 Vector8
                | Bytes32 Vector8
             deriving (Show, Read, Eq)

data UIntSized = UInt8 Word8
               | UInt16 Word16
               | UInt24 Word24
               | UInt32 Word32
               | UInt40 Word40
               | UInt48 Word48
               | UInt56 Word56
               | UInt64 Word64
               | UInt72 Word72
               | UInt80 Word80
               | UInt88 Word88
               | UInt96 Word96
               | UInt104 Word104
               | UInt112 Word112
               | UInt120 Word120
               | UInt128 Word128
               | UInt136 Word136
               | UInt144 Word144
               | UInt152 Word152
               | UInt160 Word160
               | UInt168 Word168
               | UInt176 Word176
               | UInt184 Word184
               | UInt192 Word192
               | UInt200 Word200
               | UInt208 Word208
               | UInt216 Word216
               | UInt224 Word224
               | UInt232 Word232
               | UInt240 Word240
               | UInt248 Word248
               | UInt256 Word256
             deriving (Show, Read, Eq)

data IntSized  = Int8 Word8
               | Int16 Word16
               | Int24 Word24
               | Int32 Word32
               | Int40 Word40
               | Int48 Word48
               | Int56 Word56
               | Int64 Word64
               | Int72 Word72
               | Int80 Word80
               | Int88 Word88
               | Int96 Word96
               | Int104 Word104
               | Int112 Word112
               | Int120 Word120
               | Int128 Word128
               | Int136 Word136
               | Int144 Word144
               | Int152 Word152
               | Int160 Word160
               | Int168 Word168
               | Int176 Word176
               | Int184 Word184
               | Int192 Word192
               | Int200 Word200
               | Int208 Word208
               | Int216 Word216
               | Int224 Word224
               | Int232 Word232
               | Int240 Word240
               | Int248 Word248
               | Int256 Word256
             deriving (Show, Read, Eq)

data SolidityUnlabeledState =
  SolidityUnlabeledState {
    unlabeledState :: Map.Map StorageKey StorageValue
  , unlabeledAddress :: RawAddress
  } deriving (Show, Eq)

data SolidityLabeledState =
  SolidityLabeledState {
    labeledState :: Map.Map SolidityStateVariable SolidityStateValue,
    labeledAddress :: Maybe RawAddress
  } deriving (Show, Eq)


instance ToJSON SolidityLabeledState where
  toJSON (SolidityLabeledState state _) =
    toJSON ( Map.foldrWithKey
               (\k v mp -> Map.insert (varName k) (varValue v) mp)
               Map.empty
               state )
