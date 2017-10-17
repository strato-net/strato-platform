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
                   majorVersion :: Maybe Int
                 , minorVersion :: Maybe Int
                 , patchVersion :: Maybe Int
                 } deriving Show

instance Eq Version where
  v1 == v2 =
    let
      maj1 = from $ majorVersion v1
      min1 = from $ minorVersion v1
      pat1 = from $ patchVersion v1
      maj2 = from $ majorVersion v2
      min2 = from $ minorVersion v2
      pat2 = from $ patchVersion v2
    in (maj1 == maj2) && (min1 == min2) && (pat1 == pat2)
    where from = maybe 0 id

instance Ord Version where
  v1 `compare` v2 =
    let
      maj1 = from $ majorVersion v1
      min1 = from $ minorVersion v1
      pat1 = from $ patchVersion v1
      maj2 = from $ majorVersion v2
      min2 = from $ minorVersion v2
      pat2 = from $ patchVersion v2
    in if maj1 /= maj2
         then maj1 `compare` maj2
         else if min1 /= min2
           then min1 `compare` min2
           else pat1 `compare` pat2
    where from = maybe 0 id

toVersion :: Int -> Int -> Int -> Version
toVersion mj mn pt = Version (Just mj) (Just mn) (Just pt)

currentSolidityVersion :: Version
currentSolidityVersion = toVersion 0 4 8

minVersion :: Version
minVersion = toVersion 0 0 0

maxVersion :: Version
maxVersion = toVersion maxBound maxBound maxBound

data VersionRange = VersionRange {
                        lowerVersion :: Version
                      , upperVersion :: Version
                      } deriving Show

versionVersionRange :: Version -> VersionRange
versionVersionRange (Version Nothing  _        _       ) = VersionRange  minVersion        maxVersion
versionVersionRange (Version (Just i) Nothing  _       ) = VersionRange (toVersion i 0 0) (toVersion (i+1)  0     0   )
versionVersionRange (Version (Just i) (Just j) Nothing ) = VersionRange (toVersion i j 0) (toVersion  i    (j+1)  0   )
versionVersionRange (Version (Just i) (Just j) (Just k)) = VersionRange (toVersion i j k) (toVersion  i     j    (k+1))

type VersionSet = Version->Bool

rangeVersionSet :: VersionRange -> VersionSet
rangeVersionSet range = (\v -> (v >= lowerVersion range) && (v < upperVersion range))

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
comparatorSets = (many1 versionSet) `sepBy` lexeme (reservedOp "||")

versionSet :: SolidityParser VersionSet
versionSet = (lexeme versionIdentifier) >>= (return . rangeVersionSet)

versionIdentifier :: SolidityParser VersionRange
versionIdentifier = do
  v <- try versionRange
   <|> versionTilde
   <|> versionCarat
   <|> try versionGT
   <|> try versionLT
   <|> versionGTE
   <|> versionLTE
   <|> versionEQ
   <?> "Invalid version identifier"
  return v

versionRange :: SolidityParser VersionRange
versionRange = do
  v1 <- lexeme versionNumber
  lexeme (char '-')
  v2 <- versionNumber
  let
    vr1 = versionVersionRange v1
    vr2 = versionVersionRange v2
  return $ VersionRange (lowerVersion vr1) (upperVersion vr2)

versionTilde :: SolidityParser VersionRange
versionTilde = do
  char '~'
  v@Version{..} <- versionNumber
  case majorVersion of
    Nothing -> unexpected "Illegal use of wildcard pattern"
    Just _ -> do
      case patchVersion of
        Just _ -> return . versionVersionRange $ Version majorVersion minorVersion Nothing
        Nothing -> return $ versionVersionRange v

versionCarat :: SolidityParser VersionRange
versionCarat = do
  char '^'
  v <- versionNumber
  case majorVersion v of
    Nothing -> unexpected "Illegal use of wildcard pattern"
    Just _ -> do
      let
        major = from $ majorVersion v
        minor = from $ minorVersion v
        patch = from $ patchVersion v
      if major > 0
        then return . VersionRange v $ toVersion (major+1) 0 0
        else
          if minor > 0
            then return . VersionRange v $ toVersion 0 (minor+1) 0
            else return . VersionRange v $ toVersion 0 0 (patch+1)
      where from = maybe 0 id

versionEQ :: SolidityParser VersionRange
versionEQ = optional (char '=') >> versionNumber >>= (return . versionVersionRange)

versionGT :: SolidityParser VersionRange
versionGT = char '>' >> versionNumber >>= (return . flip VersionRange maxVersion . upperVersion . versionVersionRange)

versionLT :: SolidityParser VersionRange
versionLT = char '<' >> versionNumber >>= (return . VersionRange minVersion . lowerVersion . versionVersionRange)

versionGTE :: SolidityParser VersionRange
versionGTE = string ">=" >> versionNumber >>= (return . flip VersionRange maxVersion . lowerVersion . versionVersionRange)

versionLTE :: SolidityParser VersionRange
versionLTE = string "<=" >> versionNumber >>= (return . VersionRange minVersion . upperVersion . versionVersionRange)

versionNumber :: SolidityParser Version
versionNumber = do
  optional (char 'v')
  major <- versionPart
  option (Version major Nothing Nothing) $ do
    dot
    minor <- versionPart
    option (Version major minor Nothing) $ do
      dot
      patch <- versionPart
      return (Version major minor patch)

versionPart :: SolidityParser (Maybe Int)
versionPart = (int >>= return . Just) <|> (oneOf "Xx*" >> return Nothing)
