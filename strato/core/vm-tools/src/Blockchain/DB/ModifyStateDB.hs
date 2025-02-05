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
import Blockchain.Strato.Model.Address
import Control.Monad (void)
import qualified Control.Monad.Change.Alter as A

addToBalance ::
  ((Address `A.Alters` AddressState) m) =>
  Address ->
  Integer ->
  m Bool
addToBalance address val = do
  A.lookupWithDefault (A.Proxy @AddressState) address >>= \addressState ->
    let newVal = addressStateBalance addressState + val
     in if newVal < 0
          then return False
          else True <$ A.insert A.Proxy address addressState {addressStateBalance = newVal}

pay ::
  ((Address `A.Alters` AddressState) m) =>
  String ->
  Address ->
  Address ->
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
