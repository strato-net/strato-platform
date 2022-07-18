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

import           Prelude                               hiding (lookup)

import           Control.Monad
import           Data.Either.Extra
import           Data.Maybe
import           Data.SemVer
import qualified Data.Text                             as T
import           GHC.Generics
import           Text.Parsec


import           SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.Imports
import           SolidVM.Solidity.Parse.Lexer
import           SolidVM.Solidity.Parse.ParserTypes
import           SolidVM.Solidity.Parse.Pragmas

newtype File = File {
  unsourceUnits :: [SourceUnit]
} deriving (Show, Generic)

solidityFile :: SolidityParser File
solidityFile = do
  whiteSpace
  units <- many (solidityPragma <|> solidityImport <|> solidityFreeFunction <|> solidityContract)
  eof
  return . File $ units

decideVersion :: File -> SolcVersion
decideVersion = maximum . (ZeroPointFour:) . mapMaybe go . unsourceUnits
  where go :: SourceUnit -> Maybe SolcVersion
        go (Pragma _ pragmaName rest) = do
          guard $ pragmaName == "solidity"
          rng <- eitherToMaybe . parseSemVerRange . T.strip . T.pack $ rest
          -- It would be much better to check for a nonempty intersection of ranges,
          -- but this simple enough that its hard to be wrong.
          let possibilities = [semver 0 5 n | n <- [0..99]]
          guard $ any (matchesSimple rng) possibilities
          return ZeroPointFive
        go _ = Nothing

{-
("doTheDivide", 
  Func{ funcArgs = []
      , funcVals = [(Nothing,IndexedType {indexedTypeIndex = 0, indexedTypeType = Int {signed = Just False, bytes = Nothing}})]
      , funcStateMutability = Nothing
      , funcContents = Just [Return (Just (Binary (line 5, column 15) - (line 5, column 17): ()  "/" (NumberLiteral (line 5, column 13) - (line 5, column 15): ()  1 Nothing) (NumberLiteral (line 5, column 17) - (line 5, column 18): ()  0 Nothing))) (line 5, column 5) - (line 5, column 19): () ]
      , funcVisibility = Just Public
      , funcConstructorCalls = fromList []
      , funcModifiers = Just []
      , funcContext = (line 4, column 3) - (line 4, column 48): () 
  }
)

("sum",
  Func {funcArgs = [(Just "arr",IndexedType {indexedTypeIndex = 0, indexedTypeType = Array {entry = Int {signed = Just False, bytes = Nothing}, length = Nothing}})]
        , funcVals = [(Just "s",IndexedType {indexedTypeIndex = 0, indexedTypeType = Int {signed = Just False, bytes = Nothing}})]
        , funcStateMutability = Just Pure
        , funcContents = Just [ForStatement (Just (VariableDefinition [VarDefEntry {vardefType = Just (Int {signed = Just False, bytes = Nothing}), _vardefLocation = Nothing, vardefName = "i", vardefContext = (line 5, column 8) - (line 5, column 15): () }] (Just (NumberLiteral (line 5, column 17) - (line 5, column 18): ()  0 Nothing)))) (Just (Binary (line 5, column 22) - (line 5, column 24): ()  "<" (Variable (line 5, column 20) - (line 5, column 22): ()  "i") (MemberAccess (line 5, column 27) - (line 5, column 34): ()  (Variable (line 5, column 24) - (line 5, column 27): ()  "arr") "length"))) (Just (PlusPlus (line 5, column 37) - (line 5, column 39): ()  (Variable (line 5, column 36) - (line 5, column 37): ()  "i"))) [SimpleStatement (ExpressionStatement (Binary (line 6, column 7) - (line 6, column 10): ()  "+=" (Variable (line 6, column 5) - (line 6, column 7): ()  "s") (IndexAccess (line 6, column 13) - (line 6, column 16): ()  (Variable (line 6, column 10) - (line 6, column 13): ()  "arr") (Just (Variable (line 6, column 14) - (line 6, column 15): ()  "i"))))) (line 6, column 5) - (line 6, column 16): () ] (line 5, column 3) - (line 8, column 1): () ]
        , funcVisibility = Just Public
        , funcConstructorCalls = fromList []
        , funcModifiers = Just []
        , funcContext = (line 4, column 1) - (line 4, column 55): () }
-}