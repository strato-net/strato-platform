-- |
-- Module: File
-- Description: Parses anything that can appear at the top level of
--   a Solidity source file
-- Maintainer: Ryan Reich <ryan@blockapps.net>
--
-- Currently does contracts and pragmas.  In the future should also handle
-- imports.
module SolidVM.Solidity.Parse.File where

import           Prelude                               hiding (lookup)

import           Control.Monad
import           Data.Either.Extra
import           Data.Maybe
import           Data.SemVer
import qualified Data.Text                             as T
import           Text.Parsec


import           SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.Lexer
import           SolidVM.Solidity.Parse.ParserTypes
import           SolidVM.Solidity.Parse.Pragmas


newtype File = File {
  unsourceUnits :: [SourceUnit]
} deriving (Show, Read)

solidityFile :: SolidityParser File
solidityFile = do
  whiteSpace
  units <- many (solidityPragma <|> solidityContract)
  eof
  return . File $ units


decideVersion :: File -> SolcVersion
decideVersion = maximum . (ZeroPointFour:) . mapMaybe go . unsourceUnits
  where go :: SourceUnit -> Maybe SolcVersion
        go NamedXabi{} = Nothing
        go (Pragma pragmaName rest) = do
          guard $ pragmaName == "solidity"
          rng <- eitherToMaybe . parseSemVerRange . T.strip . T.pack $ rest
          -- It would be much better to check for a nonempty intersection of ranges,
          -- but this simple enough that its hard to be wrong.
          let possibilities = [semver 0 5 n | n <- [0..99]]
          guard $ any (matchesSimple rng) possibilities
          return ZeroPointFive
