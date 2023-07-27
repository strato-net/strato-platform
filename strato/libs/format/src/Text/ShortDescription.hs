module Text.ShortDescription where

class ShortDescription a where
  shortDescription :: a -> String
