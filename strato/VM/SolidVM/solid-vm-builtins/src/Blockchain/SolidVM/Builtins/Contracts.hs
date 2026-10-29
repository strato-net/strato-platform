{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.SolidVM.Builtins.Contracts (payable, selfdestruct, create, create2, contractCast, contractCode) where

import Blockchain.SolidVM.Execution
import Blockchain.Data.ExecResults (erNewContractAddress)
import Blockchain.SolidVM.Exception (invalidArguments, internalError)
import SolidVM.Model.SolidString (stringToLabel)
import SolidVM.Model.Value (Value (..), ValList)
import Blockchain.VMContext (getNewAddress, getNewAddressWithSalt)
import Data.Maybe (fromMaybe)
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Blockchain.Data.AddressStateDB
import Blockchain.DB.AddressStateDB (HasAccountDB)
import Blockchain.DB.StorageDB (HasMemStorageDB)
import Blockchain.DB.ModifyStateDB (pay)
import Blockchain.SolidVM.SM (CallInfo, getCurrentAddress)
import Blockchain.VMContext (purgeStorageMap)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod

payable :: Address -> (Address, Bool)
payable address = (address, True)

selfdestruct :: (Mod.Modifiable [CallInfo] m, HasAccountDB m, HasMemStorageDB m) => Address -> m Bool
selfdestruct recipient = do
  contract <- getCurrentAddress
  amount <- addressStateBalance <$> A.lookupWithDefault (A.Proxy @AddressState) contract
  A.adjustWithDefault_ (A.Proxy @AddressState) contract $ \state ->
    pure state {addressStateCodeHash = SolidVMCode "Code_0" (unsafeCreateKeccak256FromWord256 0)}
  sent <- pay "selfdestruct function" contract recipient amount
  purgeStorageMap contract
  pure sent

create :: forall engine m. MonadContractCreation engine m => String -> String -> ValList -> m Address
create name source args = createContract @engine Nothing name source args

create2 :: forall engine m. MonadContractCreation engine m => Value -> String -> String -> ValList -> m Address
create2 salt name source args = createContract @engine (Just salt) name source args

createContract :: forall engine m. MonadContractCreation engine m => Maybe Value -> String -> String -> ValList -> m Address
createContract salt name source args
  | null name || null source = invalidArguments
      ("The contract name and src arguments for the " ++ maybe "create" (const "create2") salt ++ " function should not be empty")
      (maybe [] (: []) salt ++ [SString name, SString source] ++ args)
  | otherwise = do
      creator <- getCurrentAddress
      (hsh, cc) <- prepareContractSource @engine source
      address <- case salt of
        Nothing -> getNewAddress creator
        Just value -> getNewAddressWithSalt creator value hsh (SString name : args)
      result <- runContractConstructor @engine creator address hsh cc (stringToLabel name) args
      --Need to check that this is a UserRegistry contract before creating cirrus table!  Add this code

      pure $ fromMaybe (internalError "a call to create did not create an address" result) (erNewContractAddress result)

contractCast :: a -> a
contractCast = id

contractCode :: [String] -> String
contractCode = unlines
