{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}

-- |
-- Module: ParserTypes
-- Description: Types used throughout solidity-abi, primarily the ones
--   containing the structure of a parsed contract.
-- Maintainer: Ryan Reich <ryan@blockapps.net>
-- Maintainer: Steven Glasford <steven_glasford@blockapps.net>
module BlockApps.Solidity.Parse.ParserTypes where

import BlockApps.Solidity.Xabi
import Control.DeepSeq
import Control.Monad
import Data.Either.Extra
import Data.Maybe
import Data.SemVer
import qualified Data.Text as T
import GHC.Generics
import Text.Parsec

data SourceUnit
  = Pragma Identifier String
  | Import T.Text
  | NamedXabi T.Text (Xabi, [T.Text])
  deriving (Eq, Show, Generic, NFData)

newtype File = File
  { unsourceUnits :: [SourceUnit]
  }

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

decideVersion :: File -> SolcVersion
decideVersion = maximum . (ZeroPointFour :) . mapMaybe go . unsourceUnits
  where
    go :: SourceUnit -> Maybe SolcVersion
    go (Pragma pragmaName rest) = do
      guard $ pragmaName == "solidity"
      rng <- eitherToMaybe . parseSemVerRange . T.strip . T.pack $ rest
      -- It would be much better to check for a nonempty intersection of ranges,
      -- but this simple enough that its hard to be wrong.
      let possibilities = [semver 0 5 n | n <- [0 .. 99]]
      guard $ any (matchesSimple rng) possibilities
      return ZeroPointFive
    go _ = Nothing
