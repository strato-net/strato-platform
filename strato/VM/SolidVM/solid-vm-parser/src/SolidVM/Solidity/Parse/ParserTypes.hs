{-# LANGUAGE RecordWildCards            #-}
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

-- | We parse directly from the textual source, without pre-lexing.

-- Store the pragma version to allow for different things to happen when the pragma is different
type PragmaVersion = Identifier

-- | Names of contracts.  They have to be the same as identifiers because
-- contracts can also be types.
type ContractName = Identifier

type SourceCode = String
-- | A parser of source code whose state is the name of the current
-- contract.

data ParserState = ParserState 
    { contractName :: ContractName
    , pragmaVersion :: PragmaVersion 
    }
-- TODO: add lenses to make the referencing and changing of the parser state faster

type SolidityParser = Parsec SourceCode ParserState

--given inputs set the parser state
setParserState :: ParserState -> SolidityParser ()
setParserState ParserState{..} = putState $ ParserState {
      contractName = contractName
    , pragmaVersion = pragmaVersion
    }

--Change the Pragma Version of the ParserState with a given input
setPragmaVersion :: PragmaVersion -> SolidityParser ()
-- Given a new pragma version replace the old parser State with a new one with an updated pragma version.
setPragmaVersion p = 
    do ParserState{..} <- getState
       putState (ParserState contractName p)

--Change the contract name of the ParserState with a given input
setContractName :: ContractName -> SolidityParser ()
-- Given a new contract name replace the old parser State with a new one with an updated contract name.
setContractName cn = 
    do ParserState{..} <- getState
       putState (ParserState cn pragmaVersion)

-- Get the contract name from the parser state
getContractName :: SolidityParser ContractName
--If other items are added to the ParserState, this is very similar to how one adds
-- more get information functions.
getContractName = contractName <$> getState

-- Get the pragmaVersion from the parser state
getPragmaVersion :: SolidityParser PragmaVersion
getPragmaVersion = pragmaVersion <$> getState

-- | Not actually used.
type SolidityValue = String

data SolcVersion = ZeroPointFour | ZeroPointFive deriving (Eq, Show, Ord, Enum)
