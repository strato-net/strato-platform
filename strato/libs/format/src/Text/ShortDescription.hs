module Text.ShortDescription where

import Data.List (intercalate)

class ShortDescription a where
  shortDescription :: a -> String

instance ShortDescription a => ShortDescription [a] where
  shortDescription xs = "[" ++ intercalate ", " (map shortDescription xs) ++ "]"
