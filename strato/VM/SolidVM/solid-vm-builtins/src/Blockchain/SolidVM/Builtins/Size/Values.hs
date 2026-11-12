{-# LANGUAGE LambdaCase #-}
module Blockchain.SolidVM.Builtins.Size.Values (ValueArguments (..), valueSize, basicSize, chargeNested, chargeInnerAggregates, chargeCopy) where

import Blockchain.SolidVM.Builtins.Gas (byteWidth)
import Blockchain.SolidVM.Builtins.Size (FunctionArguments (..), gasSize, wordsFor)
import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import Blockchain.Strato.Model.Gas (Gas (..))
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

-- | Charge for everything reachable inside an aggregate, each element before
-- it is visited. 'valueSize' counts an aggregate's own slots only, but its
-- elements are references: many slots can share one large value, or lead
-- back to the aggregate itself, so whatever walks the whole value (encoding,
-- events, logging, call arguments) must pay for all of it first.
chargeNested :: MonadBuiltinGas m => Value -> m ()
chargeNested = \case
  SStruct _ fields -> mapM_ element fields
  SArray values -> mapM_ element values
  STuple values -> mapM_ element values
  SMap entries -> mapM_ element entries
  SVariadic values -> mapM_ chargeNested values
  SUserDefined _ _ value -> chargeNested value
  _ -> pure ()
  where
    element variable = do
      value <- weakGetVar variable
      chargeBuiltinGas $ Gas (max 1 (wordsFor (leafSize value)))
      chargeNested value
    leafSize value = case value of
      SStruct {} -> 0
      SArray {} -> 0
      STuple {} -> 0
      SMap {} -> 0
      _ -> valueSize value

-- | For an argument, which is handed over by reference: its own elements are
-- free, but an aggregate held in one of them is charged in full, since
-- checking the argument walks it and shared inner values multiply.
chargeInnerAggregates :: MonadBuiltinGas m => Value -> m ()
chargeInnerAggregates = \case
  SStruct _ fields -> mapM_ element fields
  SArray values -> mapM_ element values
  STuple values -> mapM_ element values
  SMap entries -> mapM_ element entries
  _ -> pure ()
  where
    element variable = do
      value <- weakGetVar variable
      case value of
        SStruct {} -> inner value
        SArray {} -> inner value
        STuple {} -> inner value
        SMap {} -> inner value
        _ -> pure ()
    inner value = chargeBuiltinGas 1 >> chargeNested value

-- | Placing an aggregate in a new cell copies its slots.
chargeCopy :: MonadBuiltinGas m => Value -> m ()
chargeCopy value = case value of
  SStruct {} -> slots
  SArray {} -> slots
  STuple {} -> slots
  _ -> pure ()
  where slots = chargeBuiltinGas $ Gas (wordsFor (valueSize value))

basicSize :: BasicValue -> Integer
basicSize = \case
  BInteger n -> max 32 (byteWidth n)
  BString s -> fromIntegral (B.length s)
  BBytes s -> fromIntegral (B.length s)
  BDecimal s -> fromIntegral (B.length s)
  BDefault -> 32
  _ -> 32
