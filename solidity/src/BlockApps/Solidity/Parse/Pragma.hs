-- |
-- Module: Pragmas
-- Description: Parsers for Solidity pragmas
-- Maintainer: Dustin Norwood <dustin@blockapps.net>

{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module BlockApps.Solidity.Parse.Pragmas (solidityPragma) where

--import Data.Either
--import           Data.List
--import qualified Data.Map                             as Map
--import Data.Map (Map)
--import           Data.Maybe
--import           Data.Text                            (Text)
--import qualified Data.Text                            as Text
--import           Data.Char

import           Text.Parsec
--import           Text.Parsec.Perm
--import           Text.Parsec.Number

import           BlockApps.Solidity.Parse.Lexer
import           BlockApps.Solidity.Parse.ParserTypes
--import           BlockApps.Solidity.Parse.Types
--
--import           BlockApps.Solidity.Xabi              (Xabi (..))
--import qualified BlockApps.Solidity.Xabi              as Xabi
--import qualified BlockApps.Solidity.Xabi.Def          as Xabi
--import qualified BlockApps.Solidity.Xabi.Type         as Xabitype
solidityPragma :: SolidityParser Bool
solidityPragma = do
  reserved "pragma"
  pragmaName <- identifier
  let
    m = 6
  many1 (oneOf "v0123456789.Xx*")
  semi
  if pragmaName /= "solidity"
    then return False
    else return True

{-
type Version = (Int,Int,Int)

type VersionSet = Version->Bool

versionIdentifier :: SolidityParser VersionSet
versionIdentifier = do
  optional (char 'v')
  versionSet <- (try threePartWildcard <|> try twoPartWildcard <|> onePartWildcard)
         <|> (try threePartVersion  <|> try twoPartVersion  <|> onePartVersion)
  return versionSet

threePartVersion :: SolidityParser VersionSet
threePartVersion = do
  major <- int
  dot
  minor <- int
  dot
  patch <- int
  return (\v -> v == (major,minor,patch))

twoPartVersion :: SolidityParser VersionSet
twoPartVersion = do
  major <- int
  dot
  minor <- int
  return (\v -> v == (major,minor,0))

onePartVersion :: SolidityParser VersionSet
onePartVersion = do
  major <- int
  return (\v -> v == (major,0,0))

threePartWildcard :: SolidityParser VersionSet
threePartWildcard = do
  major <- int
  dot
  minor <- int
  dot
  oneOf "Xx*"
  return (\v -> v >= (major,minor,0) && v < (major,minor+1,0))

twoPartWildcard :: SolidityParser VersionSet
twoPartWildcard = do
  major <- int
  dot
  oneOf "Xx*"
  return (\v -> v >= (major,0,0) && v < (major+1,0,0))

onePartWildcard :: SolidityParser VersionSet
onePartWildcard = do
  oneOf "Xx*"
  return (\v -> True)

versionComparator :: SolidityParser (Version -> Bool)
versionComparator = do
  f <- (string ">" >> return (>))
   <|> string ("<" >> return (<))
   <|> string ("=" >> return (==))
   <|> string ("<=" >> return (<=))
   <|> string (">=" >> return (>=))
   <?> (==)
  v <- versionIdentifier
  return $ f v

versionRange :: SolidityParser (Version -> Bool)
versionRange = do
  v1 <- versionIdentifier
  char '-'
  v2 <- versionIdentifier
  return (\v -> (v >= v1) && (v <= v2))

satisfiesVersion :: Version -> VersionSet -> Bool
satisfiesVersion v f = f v
-}
