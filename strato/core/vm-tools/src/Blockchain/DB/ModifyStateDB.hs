{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.DB.ModifyStateDB
  ( addToBalance,
    pay,
  )
where

import Blockchain.Data.AddressStateDB
import Blockchain.Strato.Model.Account
import Control.Monad (void)
import qualified Control.Monad.Change.Alter as A

addToBalance ::
  ((Account `A.Alters` AddressState) m) =>
  Account ->
  Integer ->
  m Bool
addToBalance account val = do
  A.lookupWithDefault (A.Proxy @AddressState) account >>= \addressState ->
    let newVal = addressStateBalance addressState + val
     in if newVal < 0
          then return False
          else True <$ A.insert A.Proxy account addressState {addressStateBalance = newVal}

pay ::
  ((Account `A.Alters` AddressState) m) =>
  String ->
  Account ->
  Account ->
  Integer ->
  m Bool
pay _description fromAddr toAddr val = do
  balance <- addressStateBalance <$> A.lookupWithDefault (A.Proxy :: A.Proxy AddressState) fromAddr
  if balance < val
    then return False
    else do
      void $ addToBalance fromAddr (-val)
      void $ addToBalance toAddr val
      return True
