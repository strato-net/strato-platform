module Blockchain.SolidVM.Builtins.Operations.Metered
  ( functionEntry, localWrite, localWriteCost, storageRead, storageWrite, dataWrite, stringLength, allocate, allocateBytes, memoryPush, invoke, invokeSized, wordsFor ) where

import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import Blockchain.SolidVM.Builtins.Size (GasSize (..), FunctionArguments (..), wordsFor, pathSize)
import SolidVM.Model.Storable (StoragePath)
import qualified Data.Text as T
import Blockchain.Strato.Model.Gas (Gas (..))

functionEntry :: (MonadBuiltinGas m, FunctionArguments args) => args -> m ()
functionEntry args = chargeBuiltinGas $ Gas (5 + argumentWords args)

localWrite :: MonadBuiltinGas m => m ()
localWrite = chargeBuiltinGas (Gas localWriteCost)

localWriteCost :: Integer
localWriteCost = 1

-- Storage accesses are charged by the size of the path (field names and
-- mapping keys) as well as the value.
storageRead :: MonadBuiltinGas m => StoragePath -> (a -> Integer) -> m a -> m a
storageRead path size readValue = do
  chargeBuiltinGas $ Gas (5 + wordsFor (pathSize path))
  value <- readValue
  chargeBuiltinGas $ Gas (wordsFor (size value))
  pure value

storageWrite :: MonadBuiltinGas m => StoragePath -> Integer -> m ()
storageWrite path bytes = dataWrite (pathSize path + bytes)

-- | Permanent data is charged per 32 bytes written.
dataWrite :: MonadBuiltinGas m => Integer -> m ()
dataWrite bytes = chargeBuiltinGas $ Gas (20 + wordsFor bytes)

-- | Counting a string's characters reads all of it.
stringLength :: MonadBuiltinGas m => T.Text -> m Int
stringLength s = invokeSized s (pure (T.length s))

allocate :: MonadBuiltinGas m => Integer -> m ()
allocate count = chargeBuiltinGas $ Gas (1 + max 0 count)

-- | A zeroed byte string is charged per 32 bytes.
allocateBytes :: MonadBuiltinGas m => Integer -> m ()
allocateBytes bytes = allocate ((max 0 bytes + 31) `div` 32)

-- | Appending to a memory array of the given length copies it; charged at
-- one unit per 256 elements.
memoryPush :: MonadBuiltinGas m => Int -> m ()
memoryPush elements = invoke (fromIntegral elements `div` 8) (pure ())

invoke :: MonadBuiltinGas m => Integer -> m a -> m a
invoke bytes action = chargeBuiltinGas (Gas (1 + wordsFor bytes)) >> action

invokeSized :: (MonadBuiltinGas m, GasSize a) => a -> m b -> m b
invokeSized value = invoke (gasSize value)
