-- | 
-- Module: ParserTypes
-- Description: Types used throughout solidity-abi, primarily the ones
--   containing the structure of a parsed contract.  
-- Maintainer: Ryan Reich <ryan@blockapps.net>
module BlockApps.Solidity.Parse.ParserTypes where

import Text.Parsec

import Numeric.Natural

import qualified BlockApps.Solidity.Xabi.Type as Xabitype

-- | Source file names; also source file /paths/.
type FileName = SourceName
-- | Names of types, variables, functions, etc. in Solidity code.
type Identifier = String
-- | Names of contracts.  They have to be the same as identifiers because
-- contracts can also be types.
type ContractName = Identifier
-- | We parse directly from the textual source, without pre-lexing.

type SourceCode = String
-- | A parser of source code whose state is the name of the current
-- contract.
type SolidityParser = Parsec SourceCode ContractName

-- | When starting a new contract
setContractName :: ContractName -> SolidityParser ()
setContractName = setState

-- | There are a few context-sensitive constructs in Solidity, for example
-- constructors.
getContractName :: SolidityParser ContractName
getContractName = getState

-- | What can appear as the type of a variable.
data SolidityBasicType =
  -- | 'bool' type
  Boolean |
  -- | 'address' type
  Address |
  -- | 'intX' type, where X is converted from bits to bytes for consistency
  -- Note that 'int == int256 == SignedInt 32'
  SignedInt   { bytes :: Natural } |
  -- | 'uintX' type, in bytes
  -- Note that 'uint = uint256 == UnsignedInt 32'
  UnsignedInt { bytes :: Natural } |
  -- | 'bytesX' type.  Natively given in bytes.
  -- Note that 'byte = bytes1 = FixedBytes 1'
  FixedBytes  { bytes :: Natural } |
  -- | 'bytes'.  The length is not known at compile time and the storage
  -- location of the data is not computed here.
  DynamicBytes|
  -- | 'string'.  Same as above.
  String |
  -- | 'T[n]' array type, recording both 'T' and 'n'.  Can be nested; i.e.
  -- 'T[n][m] == FixedArray (FixedArray T n) m'.  Note the order.
  FixedArray  { elemType :: SolidityBasicType, fixedLength :: Natural } |
  -- | 'T[]', recording only 'T'.  Can be nested.
  DynamicArray{ elemType :: SolidityBasicType } |
  -- | 'mapping(D => C)' type, recording domain 'D' and codomain 'C'.  We
  -- don't enforce restrictions on what these types allow.
  Mapping     { domType  :: Xabitype.IndexedType, codType :: Xabitype.IndexedType } |
  -- | The name of a new type, whose definition is kept in 'contractTypes'.
  Typedef     { typedefName :: Identifier }
  deriving (Show, Eq)

-- | Not actually used.
type SolidityValue = String



