-- |
-- Module: Types
-- Description: Parsers for type expressions
-- Maintainer: Ryan Reich <ryan.reich@gmail.com>
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}
module SolidVM.Solidity.Parse.Types where

import           Control.Monad
import           Data.List
import           Data.Int                  (Int32)

import           Text.Parsec
import           Text.Read (readMaybe)

import           SolidVM.Solidity.Parse.Expression
import           SolidVM.Solidity.Parse.Lexer
import           SolidVM.Solidity.Parse.ParserTypes


import           SolidVM.Model.SolidString
import qualified SolidVM.Model.Type         as SVMType

-- | A type expression is either a composite type (arrays and mappings) or
-- a simple type (builtins and user-defined names)
simpleTypeExpression :: SolidityParser SVMType.Type
simpleTypeExpression = try arrayType <|> simpleType <|> mappingType

-- | Parses builtins and user-defined names
simpleType :: SolidityParser SVMType.Type
simpleType =
  simple "bool" SVMType.Bool <|>
  simple "address payable" (SVMType.Address True) <|>
  simple "address" (SVMType.Address False) <|>
  simple "account payable" (SVMType.Account True) <|>
  simple "account" (SVMType.Account False) <|>
  simple "string" (SVMType.String $ Just True) <|>
  bytes' <|>
  intSuffixed "uint"  (SVMType.Int (Just False)) <|>
  intSuffixed "int"  (SVMType.Int (Just True)) <|>
  fixedSuffixed "fixed" (SVMType.Fixed (Just True)) <|> -- fixed256x10 ->   
  fixedSuffixed "ufixed" (SVMType.Fixed (Just False)) <|>
  SVMType.UnknownLabel . stringToLabel <$>
    choice [
      identifier,
      concat <$> sequence [identifier, dot, identifier]
    ]
  where
    simple name nameType = do
      reserved name
      return nameType
    bytes' = -- To avoid shadowing another "bytes"
      simple "byte" (SVMType.Bytes Nothing $ Just 1) <|>
      simple "bytes" (SVMType.Bytes (Just True) Nothing) <|>
      lexeme (try $ do
         let base = "bytes"
         chars <- many1 alphaNum
         when (not (base `isPrefixOf` chars)) $ fail "missing 'bytes'"

         size <-
            case reads (drop (length base) chars) of
              [] -> return Nothing
              [(number, "")] -> do
                when (not $ number `elem` [1..32]) $ fail "invalid bytes size"
                return $ Just number
              _ ->  fail "invalid bytes size"

         return $ SVMType.Bytes Nothing size
      )
    intSuffixed base baseType = lexeme $ try $ do
      chars <- many1 alphaNum

      when (not (base `isPrefixOf` chars)) $ fail "missing base"
      number <-
            case reads (drop (length base) chars) of
              [] -> return Nothing
              [(number, "")] -> do
                when (not $ number `elem` [8, 16 .. 256]) $ fail "invalid size"
                return $ Just $ number `quot` 8 --   bytes
              _ ->  fail "invalid size"

      return $ baseType number


    fixedSuffixed base baseType = lexeme $ try $ do
      chars <- many1 alphaNum
      unless (base `isPrefixOf` chars) $ fail "missing base" -- make this return 128, 18 default
      decimals <- do
        let afterFixed = (drop (length base) chars)
        case afterFixed of -- | fixed128  x18 -> 128x18
          "" -> return Nothing
          xs -> do --splitAt :: [a] -> a ([a],[a]) --128x56 
            let mySplitFunc fs theMatch = mySplitFuncHelper ([],fs) theMatch
                mySplitFuncHelper (as,[]) _ = (as,[])
                mySplitFuncHelper (as,(y:ys)) z = case y == z of 
                  True -> (as, ys)
                  False -> mySplitFuncHelper ((as++[y]),ys) z

            let theSplit = xs `mySplitFunc` 'x'
            when (null(fst theSplit) || null (snd theSplit)) $ fail "big bad"
            let n1 = readMaybe (fst theSplit) :: Maybe Int32
            let n2 = readMaybe (snd theSplit) :: Maybe Int32
            case (n1,n2) of
              (Just x, Just y) -> do
                when (not (x `elem` [8,16..256]) || not (y `elem` [0..80])) $ fail "invalid fixed sizes"
                return $ Just (x,y)
              _ -> return Nothing
                 -- | ("128x18", "")    
      return $ baseType decimals 

-- array length so long as they only reference explicit numbers.  Note that
-- for nested arrays, we have 'T[n][m] = (T[n])[m]' rather than '(T[m])[n]'
-- as in C.
arrayType :: SolidityParser SVMType.Type
arrayType = do
  baseElemType <- simpleType <|> mappingType
  sizeList <- many1 $ brackets $ optionMaybe intExpr
  return $ combine baseElemType sizeList
    where combine :: SVMType.Type -> [Maybe Word] -> SVMType.Type
          combine t [] = t
          combine t (l:ls) = combine (SVMType.Array t l) ls

-- | Parses mapping types, ignoring possible restrictions on what the
-- domain and codomain can be.
mappingType :: SolidityParser SVMType.Type
mappingType = do
  reserved "mapping"
  (mapDomT, mapCodT) <- parens $ do
    d <- simpleTypeExpression
    reservedOp "=>"
    c <- simpleTypeExpression
    return (d, c)
  return $ SVMType.Mapping (Just True) mapDomT mapCodT
