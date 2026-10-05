{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleContexts #-}

module SolidVM.Gas (decrementGas) where

import Blockchain.SolidVM.Exception
import Blockchain.SolidVM.GasInfo
import Blockchain.SolidVM.SM
import Blockchain.Strato.Model.Gas
import Control.Lens
import Control.Monad

decrementGas :: MonadSM m => Gas -> m ()
decrementGas !gas = do
  state <- chargeGasState gas
  when (state ^. gasLeft < Gas 0) $
    tooMuchGas (getGasValue $ _gasInitialAllotment state) (getGasValue $ state ^. gasUsed)
