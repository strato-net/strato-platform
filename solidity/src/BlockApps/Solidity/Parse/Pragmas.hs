-- |
-- Module: Pragmas
-- Description: Parsers for Solidity pragmas
-- Maintainer: Dustin Norwood <dustin@blockapps.net>
{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module BlockApps.Solidity.Parse.Pragmas (solidityPragma) where

import           Text.Parsec
import           Text.Parsec.Number

import           BlockApps.Solidity.Parse.Lexer
import           BlockApps.Solidity.Parse.ParserTypes

data Version = Version {
                   majorVersion :: Int
                 , minorVersion :: Int
                 , patchVersion :: Int
                 } deriving Show

data VersionRange = VersionRange {
                        lowerVersion :: Version
                      , upperVersion :: Version
                      } deriving Show

versionVersionRange :: Version -> VersionRange
versionVersionRange v@Version{..} = VersionRange v v{patchVersion = patchVersion + 1}

rangeVersionSet :: VersionRange -> VersionSet
rangeVersionSet range = (\v -> (v >= lowerVersion range) && (v < upperVersion range))

type VersionSet = Version->Bool

instance Eq Version where
  v1 == v2 = (majorVersion v1 == majorVersion v2)
          && (minorVersion v1 == minorVersion v2)
          && (patchVersion v1 == patchVersion v2)

instance Ord Version where
  v1 `compare` v2 = if majorVersion v1 /= majorVersion v2
                      then majorVersion v1 `compare` majorVersion v2
                      else if minorVersion v1 /= minorVersion v2
                        then minorVersion v1 `compare` minorVersion v2
                        else patchVersion v1 `compare` patchVersion v2

currentSolidityVersion :: Version
currentSolidityVersion = Version 0 4 8

minVersion :: Version
minVersion = Version 0 0 0

maxVersion :: Version
maxVersion = Version maxBound maxBound maxBound

evaluateVersionSets :: Version -> [VersionSet] -> Bool
evaluateVersionSets v = all (flip ($) v)

solidityPragma :: SolidityParser (Maybe String)
solidityPragma = do
  reserved "pragma"
  pragmaName <- identifier
  sets <- comparatorSets
  semi
  if (pragmaName /= "solidity")
    then return . Just $ "SyntaxError: Unknown pragma \"" ++ pragmaName ++ "\""
    else if any (evaluateVersionSets currentSolidityVersion) sets
      then return Nothing
      else return $ Just "SyntaxError: Source file requires different compiler version"

comparatorSets :: SolidityParser [[VersionSet]]
comparatorSets = (many1 versionSet) `sepBy` (reservedOp "||" >> whiteSpace)

versionSet :: SolidityParser VersionSet
versionSet = versionIdentifier >>= (return . rangeVersionSet)

versionIdentifier :: SolidityParser VersionRange
versionIdentifier = do
  v <- try versionRange
   <|> versionCarat
   <|> try versionGT
   <|> try versionLT
   <|> versionGTE
   <|> versionLTE
   <|> versionEQ
   <?> "Invalid version identifier"
  optional whiteSpace
  return v

versionRange :: SolidityParser VersionRange
versionRange = do
  v1 <- versionNumber
  whiteSpace >> char '-' >> whiteSpace
  v2 <- versionNumber
  return $ VersionRange (lowerVersion v1) (upperVersion v2)

versionCarat :: SolidityParser VersionRange
versionCarat = do
  char '^'
  VersionRange{..} <- versionNumber
  let
    major = majorVersion lowerVersion
    minor = minorVersion lowerVersion
    patch = patchVersion lowerVersion
  if major > 0
    then return . VersionRange lowerVersion $ Version (major+1) 0 0
    else
      if minor > 0
        then return . VersionRange lowerVersion $ Version 0 (minor+1) 0
        else return . VersionRange lowerVersion $ Version 0 0 (patch+1)

versionEQ :: SolidityParser VersionRange
versionEQ = do
  optional (char '=')
  range <- versionNumber
  return range

versionGT :: SolidityParser VersionRange
versionGT = do
  char '>'
  range <- versionNumber
  return $ VersionRange (upperVersion range) maxVersion

versionLT :: SolidityParser VersionRange
versionLT = do
  char '<'
  range <- versionNumber
  return $ VersionRange minVersion (lowerVersion range)

versionGTE :: SolidityParser VersionRange
versionGTE = do
  string ">="
  range <- versionNumber
  return $ VersionRange (lowerVersion range) maxVersion

versionLTE :: SolidityParser VersionRange
versionLTE = do
  string "<="
  range <- versionNumber
  return $ VersionRange minVersion (upperVersion range)

versionNumber :: SolidityParser VersionRange
versionNumber = do
  optional (char 'v')
  range <- try threePartWildcard
       <|> try threePartVersion
       <|> try twoPartWildcard
       <|> try twoPartVersion
       <|> onePartWildcard
       <|> onePartVersion
       <?> "Couldn't parse version number"
  return range

threePartVersion :: SolidityParser VersionRange
threePartVersion = do
  major <- int
  dot
  minor <- int
  dot
  patch <- int
  return . versionVersionRange $ Version major minor patch

twoPartVersion :: SolidityParser VersionRange
twoPartVersion = do
  major <- int
  dot
  minor <- int
  return $ VersionRange (Version major minor 0) (Version major (minor+1) 0)

onePartVersion :: SolidityParser VersionRange
onePartVersion = do
  major <- int
  return $ VersionRange (Version major 0 0) (Version (major+1) 0 0)

threePartWildcard :: SolidityParser VersionRange
threePartWildcard = do
  major <- int
  dot
  minor <- int
  dot
  oneOf "Xx*"
  return $ VersionRange (Version major minor 0) (Version major (minor+1) 0)

twoPartWildcard :: SolidityParser VersionRange
twoPartWildcard = do
  major <- int
  dot
  oneOf "Xx*"
  return $ VersionRange (Version major 0 0) (Version (major+1) 0 0)

onePartWildcard :: SolidityParser VersionRange
onePartWildcard = do
  oneOf "Xx*"
  return $ VersionRange minVersion maxVersion
