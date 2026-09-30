{-# LANGUAGE OverloadedStrings #-}
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
import SolidVM.Model.SolidString (SolidString, labelToString)
import SolidVM.Model.CodeCollection (resolveSolidVMVersion)
import Text.Parsec

-- | Source file names; also source file /paths/.
type FileName = SourceName

-- | Names of types, variables, functions, etc. in Solidity code.
type Identifier = SolidString

-- | We parse directly from the textual source, without pre-lexing.

-- Store the pragma version to allow for different things to happen when the pragma is different
type PragmaVersion = String

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
    userDefinedTypes :: (M.Map SolidString String),
    contractSrcLength :: Int,
    -- | Parse expressions with the pre-fork operator table, in which assignment
    -- bound tighter than @&&@ / @||@ (so @a = b || c@ meant @(a = b) || c@) and
    -- the ternary bound tighter than both. Only the VM sets this, for blocks
    -- before the operator-precedence fork; everything else parses Solidity's
    -- real precedence.
    legacyOperatorPrecedence :: Bool,
    -- | Parse expressions by reading the operator after each operand once
    -- ('SolidVM.Solidity.Parse.Statement.climb') rather than with
    -- 'Text.Parsec.Expr.buildExpressionParser'. Both accept the same language
    -- and build the same tree; only the error messages on rejected input
    -- differ, which 'runWithReference' hides by re-parsing with the reference.
    fastExpressions :: Bool
  }

-- TODO: add lenses to make the referencing and changing of the parser state faster

type SolidityParser = Parsec SourceCode ParserState

initialParserState :: ParserState
initialParserState = ParserState "" "" [] M.empty 0 False True

-- | Run @p@ with the fast expression parser and, only if that rejects the
-- input, again with the reference one, so the error reported is exactly the
-- reference parser's. Successful parses of the two are identical.
runWithReference :: SolidityParser a -> ParserState -> SourceName -> SourceCode -> Either ParseError a
runWithReference p st name src =
  case runParser p st {fastExpressions = True} name src of
    Left _ -> runParser p st {fastExpressions = False} name src
    r -> r

initialParserStateWithLength :: Int -> ParserState
initialParserStateWithLength srcLength = ParserState "" "" [] M.empty srcLength False True

-- | The parser state the VM uses for code that must keep its pre-fork meaning.
withLegacyOperatorPrecedence :: Bool -> ParserState -> ParserState
withLegacyOperatorPrecedence legacy st = st {legacyOperatorPrecedence = legacy}

getLegacyOperatorPrecedence :: SolidityParser Bool
getLegacyOperatorPrecedence = legacyOperatorPrecedence <$> getState

getFastExpressions :: SolidityParser Bool
getFastExpressions = fastExpressions <$> getState

--given inputs set the parser state
setParserState :: ParserState -> SolidityParser ()
setParserState = putState

--Change the Pragma Version of the ParserState with a given input
setPragmaVersion :: PragmaVersion -> SolidityParser ()
-- Given a new pragma version replace the old parser State with a new one with an updated pragma version.
setPragmaVersion p =
  do
    ParserState {..} <- getState
    putState (ParserState contractName p pragmas userDefinedTypes contractSrcLength legacyOperatorPrecedence fastExpressions)

--Change the contract name of the ParserState with a given input
setContractName :: ContractName -> SolidityParser ()
-- Given a new contract name replace the old parser State with a new one with an updated contract name.
setContractName cn =
  do
    ParserState {..} <- getState
    putState (ParserState cn pragmaVersion pragmas userDefinedTypes contractSrcLength legacyOperatorPrecedence fastExpressions)

addPragma :: SolidString -> String -> SolidityParser ()
addPragma k v = do
  ParserState {..} <- getState
  case k of
    "solidvm" ->
      let pragmaList = resolveSolidVMVersion v
          newPragmas = pragmaList ++ pragmas
      in putState $ ParserState contractName pragmaVersion newPragmas userDefinedTypes contractSrcLength legacyOperatorPrecedence fastExpressions
    _ -> putState $ ParserState contractName pragmaVersion ((labelToString k,v):pragmas) userDefinedTypes contractSrcLength legacyOperatorPrecedence fastExpressions

addUserDefinedType :: SolidString -> String -> SolidityParser ()
addUserDefinedType k v =
  --putState (ParserState contractName pragmaVersion (M.insert k v userDefinedTypes )) =<< ParserState{..} =<< getState
  do
    ParserState {..} <- getState
    putState (ParserState contractName pragmaVersion pragmas (M.insert k v userDefinedTypes) contractSrcLength legacyOperatorPrecedence fastExpressions)

-- Get the contract name from the parser state
getContractName :: SolidityParser ContractName
--If other items are added to the ParserState, this is very similar to how one adds
-- more get information functions.
getContractName = contractName <$> getState

-- Get the pragmaVersion from the parser state
getPragmaVersion :: SolidityParser PragmaVersion
getPragmaVersion = pragmaVersion <$> getState

-- Get the pragmaVersion from the parser state
getUserDefinedTypes :: SolidityParser (M.Map SolidString String)
getUserDefinedTypes = userDefinedTypes <$> getState

-- Get the pragmaVersion from the parser state
isInUserDefinedTypes :: SolidString -> SolidityParser Bool
isInUserDefinedTypes nam = M.member nam . userDefinedTypes <$> getState

-- Get the pragmaVersion from the parser state
getUserDefinedType :: SolidString -> SolidityParser (Maybe String)
getUserDefinedType nam = M.lookup nam . userDefinedTypes <$> getState

getContractSrcLength :: SolidityParser Int
getContractSrcLength = contractSrcLength <$> getState

-- | Not actually used.
type SolidityValue = String

data SolcVersion = ZeroPointFour | ZeroPointFive deriving (Eq, Show, Ord, Enum)
