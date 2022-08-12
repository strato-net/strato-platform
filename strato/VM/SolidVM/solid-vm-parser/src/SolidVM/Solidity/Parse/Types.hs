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

import qualified SolidVM.Model.Type         as SVMType
--import SolidVM.Solidity.Parse.Lexer (identifier)
import Debug.Trace

-- | A type expression is either a composite type (arrays and mappings) or
-- a simple type (builtins and user-defined names)
simpleTypeExpression :: SolidityParser SVMType.Type
simpleTypeExpression = try arrayType <|> simpleType <|> mappingType  -- <|> userType

-- | Parses builtins and user-defined names
simpleType :: SolidityParser SVMType.Type
simpleType =
  --simple  "UFixed256x18" SVMType.Bool <|>
  simple "bool" SVMType.Bool <|>
  simple "address payable" (SVMType.Address True) <|>
  simple "address" (SVMType.Address False) <|>
  simple "account payable" (SVMType.Account True) <|>
  simple "account" (SVMType.Account False) <|>
  simple "string" (SVMType.String $ Just True) <|>
  bytes' <|>
    fixedSuffixed "fixed" (SVMType.Fixed (Just True)) <|>
  fixedSuffixed "ufixed" (SVMType.Fixed (Just False)) <|>
  intSuffixed "uint"  (SVMType.Int (Just False)) <|>
  intSuffixed "int"  (SVMType.Int (Just True)) <|>
  choice [optionParser, unknownLabelParser, unknownLabelMemberParser]
  where
    optionParser =  try $ do
      name <- identifier
      salt <- braces $ do 
        reserved "salt"
        colon
        let myReallyGoodParser = do    
              myStr <- stringLiteral
              return ("\"" ++ myStr ++ "\"")

        s <- identifier <|> myReallyGoodParser  
        return s
      return $ SVMType.UnknownLabel name $ Just salt
    unknownLabelParser = try $ do
      name <- identifier
      isUserDefined <- isInUserDefinedTypes name
      if isUserDefined
        then do
          typ <- getUserDefinedType name 
          return $ (SVMType.UserDefined name (userTypeHelper' typ ))
          --return $ trace ("Are you even prinitng anything Userdefined" ++ (show name) ) (SVMType.UserDefined name (userTypeHelper' typ ))
        else return $ trace ("Are you even prinitng anything Label"  ++ (show name) ) (SVMType.UnknownLabel name Nothing)
    unknownLabelMemberParser = try $ do
      name <- concat <$> sequence[identifier, dot, identifier]
      return $ SVMType.UnknownLabel name Nothing
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
                return $ Just $ number `quot` 8 -- in bytes
              _ ->  fail "invalid size"

      return $ baseType number

    fixedSuffixed base baseType = lexeme $ try $ do
      chars <- many1 alphaNum
      unless (base `isPrefixOf` chars) $ fail "missing base"
      decimals <- do
        let afterFixed = drop (length base) chars
        case afterFixed of
          "" -> return $ Just (128 :: Int32, 18 :: Int32)
          xs -> do
            let mySplitFunc fs theMatch = mySplitFuncHelper ([],fs) theMatch
                mySplitFuncHelper (as,[]) _ = (as,[])
                mySplitFuncHelper (as,y:ys) z = if y == z then (as, ys) else mySplitFuncHelper (as++[y],ys) z

            let theSplit = xs `mySplitFunc` 'x'
            when (null(fst theSplit) || null (snd theSplit)) $ fail "missing an additional argument"
            let n1 = readMaybe (fst theSplit) :: Maybe Int32
            let n2 = readMaybe (snd theSplit) :: Maybe Int32
            case (n1,n2) of
              (Just x, Just y) -> do
                when (notElem x [8,16..256] || notElem y [0..80]) $ fail "invalid fixed sizes"
                return $ Just (x,y)
              _ -> return Nothing
      return $ baseType decimals

-- | Parses array types, allowing arithmetic expressions to specify the
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

-- userType :: SolidityParser SVMType.Type
-- userType = do  
--   return $ trace ("True in isInUserDefinedTypes")  (SVMType.Bool)
  -- nex <- identifier 
  -- boolan <- isInUserDefinedTypes nex
  -- if  boolan
  --   then return $ trace ("True in isInUserDefinedTypes")  (SVMType.Bool)
  --   else return $ trace ("False not in  isInUserDefinedTypes") (SVMType.Bool)
  -- where 
  --   simple name nameType = do
  --       reserved name
  --       return nameType

userTypeHelper' :: Maybe String -> SVMType.Type
userTypeHelper' (Just "bool")   =  SVMType.Bool
userTypeHelper' (Just "string") =  SVMType.String $ Just True
userTypeHelper' (Just "int")    =  (SVMType.Int (Just True) Nothing) 
userTypeHelper' (Just "uint")   =  (SVMType.Int (Just False) Nothing) 
userTypeHelper' _             =  SVMType.Bool  --TODO fix this