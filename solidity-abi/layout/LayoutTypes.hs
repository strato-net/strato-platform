-- |
-- Module: LayoutTypes
-- Description: Types for representing the storage layout of types and
--   variables in a parsed contract.
-- Maintainer: Ryan Reich <ryan@blockapps.net>
module LayoutTypes where

import Data.Map (Map)
import Numeric.Natural

import ParserTypes

-- | The same as in DefnTypes
type IdentT a = Map Identifier a

-- | File layout is the same as layout of all of its contracts, as they are
-- independent.
type SolidityFileLayout = SolidityContractsLayout
-- | Convenience type for layout of multiple contracts
type SolidityContractsLayout = IdentT SolidityContractLayout
-- | Convenience type for layout of multiple objects.  This is only going
-- to include variables, not functions.
type SolidityObjsLayout = IdentT SolidityObjLayout
-- | Convenience type for layout of multiple types.
type SolidityTypesLayout = IdentT SolidityTypeLayout

-- | The only things in a contract that get a storage representation are
-- global variables.  Since they may have user-defined types, we need to
-- record the storage representation of those types as well.
data SolidityContractLayout =
  ContractLayout {
    objsLayout :: SolidityObjsLayout,
    typesLayout :: SolidityTypesLayout
    }
  deriving (Show,Eq)

-- | A variable is just a chunk of memory between two storage locations.
-- We use bytes rather than the \"official\" notation of 32-byte storage
-- key combined with byte offsets because it's easier to convert back than
-- to compute with the official numbers.
data SolidityObjLayout =
  ObjLayout {
    -- | Position of the first byte of the byte's storage
    objStartBytes :: StorageBytes,
    -- | Position of the last byte (/not/ off-the-end)
    objEndBytes :: StorageBytes
    }
  deriving (Show,Eq)

-- | Storage layout of user-defined types
data SolidityTypeLayout =
  -- | Layout of a struct type
  StructLayout {
    -- | A struct is laid out the same as a contract's global variables,
    -- relative to the start of the structure.  Fortunately, Solidity
    -- specifies that structs get their own block of 32-byte aligned
    -- memory, so relocating these numbers is simply adding to the start
    -- location, with no additional rounding.
    structFieldsLayout :: SolidityObjsLayout,
    -- | Total number of bytes occupied by the struct.  This is a little
    -- tricky because the individual fields may be separated by gaps due to
    -- rounding, so it's not just the sum of their sizes.
    typeUsedBytes :: StorageBytes
    } |
  -- | Layout of an enum type
  EnumLayout {
    -- | Enums are represented as uintX, where X is the smallest number of
    -- bytes (in bits) required to represent the values of the enumeration.
    -- That is, 'X = logBase256 n', where n is the number of values.
    typeUsedBytes :: StorageBytes
    } |
  -- | Not actually a type
  UsingLayout {
    typeUsedBytes :: StorageBytes
    } |
  -- | Not explicitly declared by the programmer, but inserted during
  -- computations to represent type names that don't correspond to anything
  -- else, so are assumed to represent a contract.  In the future I'll
  -- actually match the names to declared contracts.
  ContractTLayout {
    typeUsedBytes :: StorageBytes
    }
  deriving (Show,Eq)

-- | 32-byte-aligned storage locations, divided by 32
type StorageKey = Natural
-- | Byte locations in storage, as-is
type StorageBytes = Natural

-- | Size of an 'address' variable is always 160 bits
addressBytes :: StorageBytes
addressBytes = 20

-- | Alignment of storage keys is always 32 bytes
keyBytes :: StorageBytes
keyBytes = 32

-- | Converting from the linear representation to keys
bytesToKey :: StorageBytes -> StorageKey
bytesToKey = (`quot` keyBytes)

-- | Byte location of storage indices
keyToBytes :: StorageKey -> StorageBytes
keyToBytes = (* keyBytes)
