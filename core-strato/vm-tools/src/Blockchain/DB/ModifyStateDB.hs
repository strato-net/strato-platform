{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.DB.ModifyStateDB (
  addToBalance,
  pay
) where

import           Blockchain.Output
import           Control.Monad.Trans

import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.StateDB

addToBalance :: (HasMemAddressStateDB m, HasHashDB m, HasStateDB m) =>
              Address -> Integer -> m Bool
addToBalance address val = do
  addressState <- getAddressState address

  let newVal = addressStateBalance addressState + val

  if newVal < 0
    then return False
    else do
    putAddressState address addressState{addressStateBalance = newVal}
    return True

pay :: (HasMemAddressStateDB m, HasHashDB m, HasStateDB m, MonadIO m, MonadLogger m) =>
     String -> Address -> Address -> Integer -> m Bool
pay _description fromAddr toAddr val = do
  -- TODO - figure out why the next lines create infinite loops when run in pizza app (with debug flag on)
  -- until this is resolved, I am commenting this out.
  {-
  when flags_debug $ do
    $logDebugS "pay" . T.pack $ "payment: from " ++ show (pretty fromAddr) ++ " to " ++ show (pretty toAddr) ++ ": " ++ show val ++ ", " ++ description
    fromAddressState <- getAddressState fromAddr
    $logDebugS "pay" . T.pack $ "from Funds: " ++ show (addressStateBalance fromAddressState)
    toAddressState <- getAddressState toAddr
    $logDebugS "pay" . T.pack $ "to Funds: " ++ show (addressStateBalance toAddressState)
    when (addressStateBalance fromAddressState < val) $
        $logDebugS "pay" "insufficient funds"
  -}

  fromAddressState <- getAddressState fromAddr
  if addressStateBalance fromAddressState < val
    then return False
    else do
    _ <- addToBalance fromAddr (-val)
    _ <- addToBalance toAddr val
    return True
