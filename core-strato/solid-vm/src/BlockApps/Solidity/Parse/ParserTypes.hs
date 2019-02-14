-- |
-- Module: ParserTypes
-- Description: Types used throughout solidity-abi, primarily the ones
--   containing the structure of a parsed contract.
-- Maintainer: Ryan Reich <ryan@blockapps.net>
module BlockApps.Solidity.Parse.ParserTypes where

--import           Control.Monad
--import           Data.Either.Extra
--import           Data.Maybe
--import           Data.SemVer
--import qualified Data.Text as T
import           Text.Parsec

--import           BlockApps.Solidity.Xabi


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

-- | Not actually used.
type SolidityValue = String

data SolcVersion = ZeroPointFour | ZeroPointFive deriving (Eq, Show, Ord, Enum)
