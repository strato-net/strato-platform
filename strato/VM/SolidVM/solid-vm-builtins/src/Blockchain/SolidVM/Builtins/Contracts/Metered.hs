{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE FlexibleContexts #-}

module Blockchain.SolidVM.Builtins.Contracts.Metered (payable, selfdestruct, create, create2, contractCast, contractCode) where

import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import Blockchain.SolidVM.Execution (MonadContractCreation)
import SolidVM.Model.Value (Value, ValList)
import Blockchain.DB.AddressStateDB (HasAccountDB)
import Blockchain.DB.StorageDB (HasMemStorageDB)
import Blockchain.SolidVM.SM (CallInfo)
import qualified Control.Monad.Change.Modify as Mod
import qualified Blockchain.SolidVM.Builtins.Contracts as Original
import Blockchain.SolidVM.Builtins.Operations.Metered (invoke)
import Blockchain.SolidVM.Builtins.Size
import Blockchain.Strato.Model.Address (Address)

payable :: MonadBuiltinGas m => Address -> m (Address, Bool)
payable value = invoke (gasSize value) (pure (Original.payable value))
selfdestruct :: (MonadBuiltinGas m, Mod.Modifiable [CallInfo] m, HasAccountDB m, HasMemStorageDB m) => Address -> m Bool
selfdestruct recipient = chargeBuiltinGas 5000 >> Original.selfdestruct recipient
create :: forall engine m. (MonadBuiltinGas m, MonadContractCreation engine m) => String -> String -> ValList -> m Address
create name source args = do
  chargeBuiltinGas 32000
  invoke (gasSize source) (Original.create @engine name source args)
create2 :: forall engine m. (MonadBuiltinGas m, MonadContractCreation engine m) => Value -> String -> String -> ValList -> m Address
create2 salt name source args = do
  chargeBuiltinGas 32000
  invoke (gasSize source) (Original.create2 @engine salt name source args)
contractCast :: MonadBuiltinGas m => a -> m a
contractCast value = chargeBuiltinGas 500 >> pure (Original.contractCast value)
contractCode :: MonadBuiltinGas m => [String] -> m String
contractCode values = chargeBuiltinGas 1000 >> pure (Original.contractCode values)
