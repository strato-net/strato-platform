
module LabeledError where

import           Prelude hiding (head, tail)
import qualified Prelude

import Data.Maybe
import Text.Read

read :: Read a => String -> String -> a
read s x = fromMaybe (error $ "[" ++ s ++ "] read parse error: can't parse '" ++ x ++ "'") . readMaybe $ x

head :: String -> [a] -> a
head label [] = error $ "[" ++ label ++ "]: 'head' was called on an empty list"
head _ x = Prelude.head x

tail :: String -> [a] -> [a]
tail label [] = error $ "[" ++ label ++ "]: 'tail' was called on an empty list"
tail _ x = Prelude.tail x
