{-# LANGUAGE RecordWildCards #-}

-- |
-- Module: ParserTypes
-- Description: Types used throughout solidity-abi, primarily the ones
--   containing the structure of a parsed contract.
-- Maintainer: Ryan Reich <ryan@blockapps.net>
module SolidVM.Solidity.Parse.ParserTypes where

--import           Control.Monad
--import           Data.Either.Extra
--import           Data.SemVer
--import qualified Data.Text as T

--import Debug.Trace
import qualified Data.Map as M
import SolidVM.Model.CodeCollection (resolveSolidVMVersion)
import Text.Parsec

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
  { contractName :: ContractName,
    pragmaVersion :: PragmaVersion,
    pragmas :: [(String, String)],
    userDefinedTypes :: (M.Map String String),
    contractSrcLength :: Int,
    -- | Parse expressions with the pre-fork operator table, in which assignment
    -- bound tighter than @&&@ / @||@ (so @a = b || c@ meant @(a = b) || c@) and
    -- the ternary bound tighter than both. Only the VM sets this, for blocks
    -- before the operator-precedence fork; everything else parses Solidity's
    -- real precedence.
    legacyOperatorPrecedence :: Bool
  }

-- TODO: add lenses to make the referencing and changing of the parser state faster

type SolidityParser = Parsec SourceCode ParserState

initialParserState :: ParserState
initialParserState = ParserState "" "" [] M.empty 0 False

initialParserStateWithLength :: Int -> ParserState
initialParserStateWithLength srcLength = ParserState "" "" [] M.empty srcLength False

-- | The parser state the VM uses for code that must keep its pre-fork meaning.
withLegacyOperatorPrecedence :: Bool -> ParserState -> ParserState
withLegacyOperatorPrecedence legacy st = st {legacyOperatorPrecedence = legacy}

getLegacyOperatorPrecedence :: SolidityParser Bool
getLegacyOperatorPrecedence = legacyOperatorPrecedence <$> getState

--given inputs set the parser state
setParserState :: ParserState -> SolidityParser ()
setParserState = putState

--Change the Pragma Version of the ParserState with a given input
setPragmaVersion :: PragmaVersion -> SolidityParser ()
-- Given a new pragma version replace the old parser State with a new one with an updated pragma version.
setPragmaVersion p =
  do
    ParserState {..} <- getState
    putState (ParserState contractName p pragmas userDefinedTypes contractSrcLength legacyOperatorPrecedence)

--Change the contract name of the ParserState with a given input
setContractName :: ContractName -> SolidityParser ()
-- Given a new contract name replace the old parser State with a new one with an updated contract name.
setContractName cn =
  do
    ParserState {..} <- getState
    putState (ParserState cn pragmaVersion pragmas userDefinedTypes contractSrcLength legacyOperatorPrecedence)

addPragma :: String -> String -> SolidityParser ()
addPragma k v = do
  ParserState {..} <- getState
  case k of
    "solidvm" ->
      let pragmaList = resolveSolidVMVersion v
          newPragmas = pragmaList ++ pragmas
      in putState $ ParserState contractName pragmaVersion newPragmas userDefinedTypes contractSrcLength legacyOperatorPrecedence
    _ -> putState $ ParserState contractName pragmaVersion ((k,v):pragmas) userDefinedTypes contractSrcLength legacyOperatorPrecedence

addUserDefinedType :: String -> String -> SolidityParser ()
addUserDefinedType k v =
  --putState (ParserState contractName pragmaVersion (M.insert k v userDefinedTypes )) =<< ParserState{..} =<< getState
  do
    ParserState {..} <- getState
    putState (ParserState contractName pragmaVersion pragmas (M.insert k v userDefinedTypes) contractSrcLength legacyOperatorPrecedence)

-- Get the contract name from the parser state
getContractName :: SolidityParser ContractName
--If other items are added to the ParserState, this is very similar to how one adds
-- more get information functions.
getContractName = contractName <$> getState

-- Get the pragmaVersion from the parser state
getPragmaVersion :: SolidityParser PragmaVersion
getPragmaVersion = pragmaVersion <$> getState

-- Get the pragmaVersion from the parser state
getUserDefinedTypes :: SolidityParser (M.Map String String)
getUserDefinedTypes = userDefinedTypes <$> getState

-- Get the pragmaVersion from the parser state
isInUserDefinedTypes :: String -> SolidityParser Bool
isInUserDefinedTypes nam = M.member nam . userDefinedTypes <$> getState

-- Get the pragmaVersion from the parser state
getUserDefinedType :: String -> SolidityParser (Maybe String)
getUserDefinedType nam = M.lookup nam . userDefinedTypes <$> getState

getContractSrcLength :: SolidityParser Int
getContractSrcLength = contractSrcLength <$> getState

-- | Not actually used.
type SolidityValue = String

data SolcVersion = ZeroPointFour | ZeroPointFive deriving (Eq, Show, Ord, Enum)
