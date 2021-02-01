
module LabeledError where

import Data.Maybe
import Text.Read

read :: Read a => String -> String -> a
read s x = fromMaybe (error $ "[" ++ s ++ "] read parse error: can't parse '" ++ x ++ "'") . readMaybe $ x
