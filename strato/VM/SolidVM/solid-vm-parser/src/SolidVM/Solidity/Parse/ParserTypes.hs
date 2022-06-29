-- |
-- Module: ParserTypes
-- Description: Types used throughout solidity-abi, primarily the ones
--   containing the structure of a parsed contract.
-- Maintainer: Ryan Reich <ryan@blockapps.net>
module SolidVM.Solidity.Parse.ParserTypes where

--import           Control.Monad
--import           Data.Either.Extra
--import           Data.Maybe
--import           Data.SemVer
--import qualified Data.Text as T
import           Text.Parsec

--import           SolidVM.Solidity.Xabi


-- | Source file names; also source file /paths/.
type FileName = SourceName
-- | Names of types, variables, functions, etc. in Solidity code.
type Identifier = String
-- | Names of contracts.  They have to be the same as identifiers because
-- contracts can also be types.
type Name = Identifier
-- | We parse directly from the textual source, without pre-lexing.
type PragmaVersion = Identifier

-- Add new type that stores both the contract's name and the PragmaVersion.
type ContractName = (Name, PragmaVersion)

type SourceCode = String
-- | A parser of source code whose state is the name of the current
-- contract.
type SolidityParser = Parsec SourceCode ContractState

-- | When starting a new contract
setContractName :: ContractName -> SolidityParser ()
setContractName = setState

-- | There are a few context-sensitive constructs in Solidity, for example
-- constructors and pragma versions.
getContractName :: SolidityParser ContractName
getContractName = getState

-- | Not actually used.
type SolidityValue = String

data SolcVersion = ZeroPointFour | ZeroPointFive deriving (Eq, Show, Ord, Enum)
