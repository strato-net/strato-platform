{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.TheDAOFork where

import Blockchain.DB.AddressStateDB (HasAccountDB)
import Blockchain.DB.ModifyStateDB (addToBalance)
import Blockchain.Strato.Model.Address
import Control.Monad

runTheDAOFork :: HasAccountDB m => m ()
runTheDAOFork =
  let recipAddr = Address 0x11c21cdf023498a02b8f66b472d6eab0302ad83a
  in void $ addToBalance recipAddr 32100000000
