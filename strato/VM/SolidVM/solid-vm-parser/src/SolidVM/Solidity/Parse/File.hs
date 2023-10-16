{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}

-- |
-- Module: File
-- Description: Parses anything that can appear at the top level of
--   a Solidity source file
-- Maintainer: Ryan Reich <ryan@blockapps.net>
-- Maintainer: Steven Glasford <steven_glasford@blockapps.net>
--
-- Currently does contracts and pragmas.  In the future should also handle
-- imports.
module SolidVM.Solidity.Parse.File where

import Control.DeepSeq
import Control.Monad
import Data.Either.Extra
import Data.Maybe
import Data.SemVer
import qualified Data.Text as T
import GHC.Generics
import SolidVM.Solidity.Parse.Alias
import SolidVM.Solidity.Parse.Declarations
import SolidVM.Solidity.Parse.Imports
import SolidVM.Solidity.Parse.Lexer
import SolidVM.Solidity.Parse.ParserTypes
import SolidVM.Solidity.Parse.Pragmas
import Text.Parsec
import Prelude hiding (lookup)

newtype File = File
  { unsourceUnits :: [SourceUnit]
  }
  deriving (Show, Generic, NFData)

solidityFile :: SolidityParser File
solidityFile = do
  whiteSpace
  units <-
    many
      ( solidityPragma
          <|> solidityImport
          <|> solidityFLError
          <|> solidityAlias
          <|> solidityFreeFunction
          <|> solidityContract
          <|> solidityFLConstant
          <|> solidityFLStruct
          <|> solidityFLEnum
      )
  eof
  return . File $ units

decideVersion :: File -> SolcVersion
decideVersion = maximum . (ZeroPointFour :) . mapMaybe go . unsourceUnits
  where
    go :: SourceUnit -> Maybe SolcVersion
    go (Pragma _ pragmaName rest) = do
      guard $ pragmaName == "solidity"
      rng <- eitherToMaybe . parseSemVerRange . T.strip . T.pack $ rest
      -- It would be much better to check for a nonempty intersection of ranges,
      -- but this simple enough that its hard to be wrong.
      let possibilities = [semver 0 5 n | n <- [0 .. 99]]
      guard $ any (matchesSimple rng) possibilities
      return ZeroPointFive
    go _ = Nothing
