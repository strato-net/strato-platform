{-# LANGUAGE LambdaCase #-}
module Blockchain.SolidVM.Builtins.Size.Values (ValueArguments (..), valueSize, basicSize) where

import Blockchain.SolidVM.Builtins.Gas (byteWidth)
import Blockchain.SolidVM.Builtins.Size (FunctionArguments (..), gasSize, wordsFor)
import qualified Data.ByteString as B
import qualified Data.Map as M
import qualified Data.Text as T
import qualified Data.Text.Encoding as T
import qualified Data.Vector as V
import SolidVM.Model.Value
import SolidVM.Model.Storable

newtype ValueArguments = ValueArguments [Value]

instance FunctionArguments ValueArguments where
  argumentWords (ValueArguments values) = sum (map (wordsFor . valueSize) values)

-- Aggregate fields are memory slots; storage references are never followed.
valueSize :: Value -> Integer
valueSize = \case
  SInteger n -> max 32 (byteWidth n)
  SDecimal n -> gasSize n
  SString s -> fromIntegral (B.length (T.encodeUtf8 (T.pack s)))
  SBytes b -> fromIntegral (B.length b)
  SStruct _ fields -> 32 * fromIntegral (M.size fields)
  SArray values -> 32 * fromIntegral (V.length values)
  STuple values -> 32 * fromIntegral (V.length values)
  SVariadic values -> sum (map valueSize values)
  SUserDefined _ _ value -> valueSize value
  SNULL -> 0
  _ -> 32

basicSize :: BasicValue -> Integer
basicSize = \case
  BInteger n -> max 32 (byteWidth n)
  BString s -> fromIntegral (B.length s)
  BBytes s -> fromIntegral (B.length s)
  BDecimal s -> fromIntegral (B.length s)
  BDefault -> 32
  _ -> 32
