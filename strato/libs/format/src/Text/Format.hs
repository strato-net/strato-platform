{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeSynonymInstances #-}

module Text.Format
  ( Format (..),
  )
where

import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC

class Format a where
  format :: a -> String

instance Format B.ByteString where
  format = BC.unpack . B16.encode

instance (Format a, Format b) => Format (a, b) where
  format (x, y) = "(" ++ format x ++ ", " ++ format y ++ ")"

instance (Format a, Format b, Format c) => Format (a, b, c) where
  format (x, y, z) = "(" ++ format x ++ ", " ++ format y ++ ", " ++ format z ++ ")"

instance Format a => Format [a] where
  format = show . map format

instance Format a => Format (Maybe a) where
  format = maybe "Nothing" format
