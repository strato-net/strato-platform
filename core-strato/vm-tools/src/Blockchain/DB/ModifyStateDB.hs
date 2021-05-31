{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeOperators     #-}

module Blockchain.DB.ModifyStateDB (
  addToBalance,
  pay
) where

import           Control.Monad                   (void)
import           Control.Monad.FT

import           Blockchain.Data.AddressStateDB
import           Blockchain.Strato.Model.Account

addToBalance :: (Monad m, (Account `Alters` AddressState) m) =>
              Account -> Integer -> m Bool
addToBalance account val = do
  selectWithDefault account >>= \addressState ->
    let newVal = addressStateBalance addressState + val
     in if newVal < 0
          then return False
          else True <$ insert account addressState{addressStateBalance = newVal}

pay :: (Monad m, (Account `Alters` AddressState) m)
    => String -> Account -> Account -> Integer -> m Bool
pay _description fromAddr toAddr val = do
  balance <- addressStateBalance <$> selectWithDefault fromAddr
  if balance < val
    then return False
    else do
    void $ addToBalance fromAddr (-val)
    void $ addToBalance toAddr val
    return True
