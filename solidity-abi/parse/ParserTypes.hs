-- | 
-- Module: ParserTypes
-- Description: Types used throughout solidity-abi, primarily the ones
--   containing the structure of a parsed contract.  
-- Maintainer: Ryan Reich <ryan@blockapps.net>
module ParserTypes where

import Text.Parsec
import Numeric.Natural

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

-- | Mathematically, all of the alternatives below are equivalent to
-- a function 'String -> String'.
data ImportAs =
    -- | Import a name as-is
    Unqualified |
    -- | Import a name in \"object.member\" notation
    StarPrefix ContractName |
    -- | Import a name by an unrelated alias
    Aliases [(ContractName, ContractName)]
   
-- | A parsed file.  It's important to remember which file contained
-- a contract, because it may be imported multiple times in different ways.
data SolidityFile = 
  SolidityFile {  
    -- | Contracts declared in a file.  The order actually doesn't matter.
    fileContracts :: [SolidityContract],
    -- | All imports declared in a file.  The order actually doesn't
    -- matter.
    fileImports :: [(FileName, ImportAs)]
  }

-- | The structure of a parsed contract.
data SolidityContract =
  Contract {
    -- | In the future, this type will not store the name directly.  It is
    -- only useful for knowing which function is the constructor, and
    -- otherwise can change under imports
    contractName :: ContractName,
    -- | The variables, functions, and function-like things declared in
    -- this contract.  They occur in order because for variables, the order
    -- is important.
    contractObjs :: [SolidityObjDef],
    -- | The order of types doesn't actually matter.  In fact, we allow
    -- forward references to types in our declarations.
    contractTypes :: [SolidityTypeDef],
    -- | Contracts from which this contract inherits.  The source code is
    -- ignored; it refers to the constructor arguments that may be given to
    -- a base contract.
    contractBaseNames :: [(ContractName, SourceCode)]
    }
  deriving (Show, Eq)

-- | A somewhat awkward union type.  It can mean:
-- * A plain variable (arg type = NoValue, value type = SingleValue _)
-- * A function (arg type = TupleValue _, value type = TupleValue _)
-- * A function modifier or event (arg type = TupleValue _, value type = NoValue)
data SolidityObjDef =
  ObjDef {
    -- | In the future, the name will not be stored in this type.  It is
    -- not useful at all, and any \"object\" can have its name shadowed by
    -- inheritance.
    objName :: Identifier,
    -- | Solidity doesn't properly have tuple values, but in principle...
    objValueType :: SolidityTuple,
    -- | My soon-to-be-revised attempt at \"everything is a function\"
    objArgType :: SolidityTuple,
    -- | The code for a variable's initialization or a function's body.
    -- Ignored.
    objDefn :: String,
    objIsPublic :: Bool -- These variables have accessor functions
    }
  deriving (Show, Eq)
           
-- | A new type definition, i.e. struct and enum
data SolidityTypeDef =
  TypeDef {
    -- | In the future, the name will not be stored in this type.  It is
    -- not useful at all, and can be shadowed by inheritance.
    typeName :: Identifier,
    -- | Why do we even have a separate data type?
    typeDecl :: SolidityNewType
    }
  deriving (Show, Eq)
           
-- | Solidity doesn't have tuple types, but it does have comma-separated
-- lists of function arguments and return values.  Also, although we don't
-- compile executable code, it has structured assignments via tuples.
data SolidityTuple =
  -- | Function types that don't return, arguments to variables
  NoValue |
  -- | Variable and struct field types
  SingleValue SolidityBasicType |
  -- | Argument and return lists
  TupleValue [SolidityObjDef]
  deriving (Show, Eq)

-- | This function is necessary to determine what actual kind of object we
-- are looking at.
tupleHasValue :: SolidityTuple -> Bool
tupleHasValue NoValue = False
tupleHasValue _ = True

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
  Mapping     { domType  :: SolidityBasicType, codType :: SolidityBasicType } |
  -- | The name of a new type, whose definition is kept in 'contractTypes'.
  Typedef     { typedefName :: Identifier }
  deriving (Show, Eq)
  
-- | Types that can be defined by the programmer.
data SolidityNewType =
  -- | Order of names is important, because they are numbered consecutively
  -- from 0.
  Enum        { names  :: [Identifier] } |
  -- | Structs are formatted very similarly to contracts.  Their objects
  -- can only be of "variable" kind, however.
  Struct      { fields :: [SolidityObjDef] } |
  -- | This isn't really a type; it's a misreading of the documentation and
  -- will be removed.
  Using       { usingContract :: ContractName, usingType :: Identifier } |
  -- | This will never be produced by the basic parser, but does come up
  -- when resolving 'Typedef's while assigning variable locations.
  ContractT
  deriving (Show, Eq)
  
-- | Not actually used.
type SolidityValue = String
