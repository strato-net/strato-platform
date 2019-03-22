{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE TypeSynonymInstances #-}

module Blockchain.Strato.Model.Format
  ( Format(..)
  ) where

import qualified Data.ByteString        as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8  as BC
import qualified Data.NibbleString      as N

import           Numeric

class Format a where
  format::a->String

instance Format B.ByteString where
  format = BC.unpack . B16.encode

instance Format N.NibbleString where
  format (N.EvenNibbleString bs)  = format bs
  format (N.OddNibbleString n bs) = showHex n "" ++ format bs

instance (Format a, Format b) => Format (a, b) where
  format (x, y) = "(" ++ format x ++ ", " ++ format y ++ ")"

instance Format a => Format [a] where
  format = show . map format
