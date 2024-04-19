{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.TheDAOFork where

import Blockchain.Data.AddressStateDB
import Blockchain.DB.ModifyStateDB (addToBalance)
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Control.Monad
import Control.Monad.Change.Alter

runTheDAOFork :: ((Account `Alters` AddressState) m) => m ()
runTheDAOFork = 
  let recipAddr = Account (Address 0x11c21cdf023498a02b8f66b472d6eab0302ad83a) Nothing
  in void $ addToBalance recipAddr 32100000000
