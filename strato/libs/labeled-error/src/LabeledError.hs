module LabeledError where

import Data.Bifunctor (first)
import Data.ByteString (ByteString)
import qualified Data.ByteString.Base16 as B16
import Data.Maybe
import Text.Read
import Prelude hiding (head, tail)
import qualified Prelude

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

b16Decode :: String -> ByteString -> ByteString
b16Decode label input =
  case B16.decode input of
    Right val -> val
    _ -> error $ "[" ++ label ++ "]: 'b16Decode' was called on invalid data"
