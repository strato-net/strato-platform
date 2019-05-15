{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}

module Blockchain.DB.ModifyStateDB (
  addToBalance,
  pay
) where

import           Control.Monad                   (void)
import qualified Control.Monad.Change.Alter      as A

import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.DB.MemAddressStateDB

addToBalance :: (Monad m, (Address `A.Alters` AddressState) m) =>
              Address -> Integer -> m Bool
addToBalance address val = do
  getAddressState address >>= \addressState ->
    let newVal = addressStateBalance addressState + val
     in if newVal < 0
          then return False
          else True <$ A.insert A.Proxy address addressState{addressStateBalance = newVal}

pay :: (Monad m, (Address `A.Alters` AddressState) m)
    => String -> Address -> Address -> Integer -> m Bool
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

  balance <- addressStateBalance <$> getAddressState fromAddr
  if balance < val
    then return False
    else do
    void $ addToBalance fromAddr (-val)
    void $ addToBalance toAddr val
    return True
