{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.SolidVM.Builtins.Environment.Metered (blockhash, setBlockContext, fastForward) where

import BlockApps.Logging (MonadLogger)
import Blockchain.Data.BlockSummary (BlockSummary)
import qualified Blockchain.Data.BlockHeader as BlockHeader
import Blockchain.SolidVM.Environment (Environment, blockHeader)
import Blockchain.Strato.Model.Gas (Gas (..))
import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import qualified Blockchain.SolidVM.Builtins.Environment as Original
import Blockchain.SolidVM.Builtins.Operations.Metered (invoke)
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod

blockhash :: (MonadBuiltinGas m, MonadLogger m, Mod.Accessible Environment m, (Keccak256 `A.Alters` BlockSummary) m) => Integer -> m String
blockhash number = do
  -- The lookup walks back one block summary per block; each step is a database read.
  current <- BlockHeader.number . blockHeader <$> Mod.access (Mod.Proxy @Environment)
  chargeBuiltinGas $ Gas (5 * max 0 (current - number))
  invoke 32 (Original.blockhash number)
setBlockContext :: (MonadBuiltinGas m, Mod.Modifiable Environment m) => Address -> Address -> Address -> Integer -> m ()
setBlockContext proposer prevProposer prevIntended prevRound = invoke 0 (Original.setBlockContext proposer prevProposer prevIntended prevRound)
fastForward :: (MonadBuiltinGas m, Mod.Modifiable Environment m) => Integer -> Integer -> m ()
fastForward seconds blocks = invoke 0 (Original.fastForward seconds blocks)
