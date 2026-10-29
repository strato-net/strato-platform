module Blockchain.SolidVM.Builtins.Operations.Metered
  ( functionEntry, localWrite, localWriteCost, storageRead, storageWrite, allocate, invoke, invokeSized, wordsFor ) where

import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import Blockchain.SolidVM.Builtins.Size (GasSize (..), FunctionArguments (..), wordsFor)
import Blockchain.Strato.Model.Gas (Gas (..))

functionEntry :: (MonadBuiltinGas m, FunctionArguments args) => args -> m ()
functionEntry args = chargeBuiltinGas $ Gas (5 + argumentWords args)

localWrite :: MonadBuiltinGas m => m ()
localWrite = chargeBuiltinGas (Gas localWriteCost)

localWriteCost :: Integer
localWriteCost = 1

storageRead :: MonadBuiltinGas m => (a -> Integer) -> m a -> m a
storageRead size readValue = do
  chargeBuiltinGas 5
  value <- readValue
  chargeBuiltinGas $ Gas (wordsFor (size value))
  pure value

storageWrite :: MonadBuiltinGas m => Integer -> m ()
storageWrite bytes = chargeBuiltinGas $ Gas (20 + wordsFor bytes)

allocate :: MonadBuiltinGas m => Integer -> m ()
allocate count = chargeBuiltinGas $ Gas (1 + max 0 count)

invoke :: MonadBuiltinGas m => Integer -> m a -> m a
invoke bytes action = chargeBuiltinGas (Gas (1 + wordsFor bytes)) >> action

invokeSized :: (MonadBuiltinGas m, GasSize a) => a -> m b -> m b
invokeSized value = invoke (gasSize value)
