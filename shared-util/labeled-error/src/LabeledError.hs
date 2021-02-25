
module LabeledError where

import           Data.Bifunctor (first)
import           Prelude hiding (head, tail)
import qualified Prelude

import Data.Maybe
import Text.Read

read :: Read a => String -> String -> a
read s x = fromMaybe (error $ "[" ++ s ++ "] read parse error: can't parse '" ++ x ++ "'") . readMaybe $ x

readEither :: Read a => String -> String -> Either String a
readEither s = first (const s) . Text.Read.readEither

head :: String -> [a] -> a
head label [] = error $ "[" ++ label ++ "]: 'head' was called on an empty list"
head _ x = Prelude.head x

tail :: String -> [a] -> [a]
tail label [] = error $ "[" ++ label ++ "]: 'tail' was called on an empty list"
tail _ x = Prelude.tail x
