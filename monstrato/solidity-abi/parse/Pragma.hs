
module Pragma where

import           Data.Maybe
import           Text.Parsec

import           Lexer
import           ParserTypes

--Pragma param is currently just a generic string of chars up to the ';'
--see https://github.com/ethereum/solidity/blob/develop/docs/grammar.txt for confirmation
data Pragma = Pragma String

pragma::SolidityParser Pragma
pragma = do
 string "pragma"
 many1 $ char ' '
 version <- many1 $ noneOf ";"
 char ';'
 return $ Pragma version
