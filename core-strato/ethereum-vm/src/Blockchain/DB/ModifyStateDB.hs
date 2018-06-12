{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.DB.ModifyStateDB (
  addToBalance,
  pay
) where

import           Control.Monad.Logger
import           Control.Monad.Trans

import           Blockchain.ExtWord              (Word256)
import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.StateDB

addToBalance :: (HasMemAddressStateDB m, HasHashDB m, HasStateDB m) =>
              Maybe Word256 -> Address -> Integer -> m Bool
addToBalance chainId address val = do
  addressState <- getAddressState chainId address

  let newVal = addressStateBalance addressState + val

  if newVal < 0
    then return False
    else do
    putAddressState chainId address addressState{addressStateBalance = newVal}
    return True

pay :: (HasMemAddressStateDB m, HasHashDB m, HasStateDB m, MonadIO m, MonadLogger m) =>
     String -> Maybe Word256 -> Address -> Address -> Integer -> m Bool
pay _description chainId fromAddr toAddr val = do
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

  fromAddressState <- getAddressState chainId fromAddr
  if addressStateBalance fromAddressState < val
    then return False
    else do
    _ <- addToBalance chainId fromAddr (-val)
    _ <- addToBalance chainId toAddr val
    return True
