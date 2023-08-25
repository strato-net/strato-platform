{-# LANGUAGE EmptyDataDecls #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE ForeignFunctionInterface #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeFamilies #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
--TODO : Take this next line out
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.DB.AddressStateDB
  ( getAddressState,
    getAddressStateMaybe,
    getAllAddressStates,
    getAllAddressStatesFromStateRoot,
    putAddressState,
    deleteAddressState,
    addressStateExists,
    getAddressFromHash,
    getRawStorageKeyFromHash,
    getStorageKeyFromHash,
  )
where

import Blockchain.DB.HashDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Util
import Control.Monad (liftM)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Maybe
import qualified Data.NibbleString as N

getAddressState :: HasStateDB m => Account -> m AddressState
getAddressState (Account address chainId) = do
  sr <- getStateRoot chainId
  states <- MP.getKeyVal sr $ addressAsNibbleString address

  case states of
    Nothing -> do
      -- Querying an absent state counts as initializing it.
      --TODO- decide if this is needed
      --putAddressState address b
      return b
      where
        b = blankAddressState
    Just s -> return $ (rlpDecode . rlpDeserialize . rlpDecode) s

getAddressStateMaybe :: HasStateDB m => Account -> m (Maybe AddressState)
getAddressStateMaybe (Account address chainId) = do
  sr <- getStateRoot chainId
  mState <- MP.getKeyVal sr $ addressAsNibbleString address
  return $ rlpDecode . rlpDeserialize . rlpDecode <$> mState

getAllAddressStates :: (HasHashDB m, HasStateDB m) => Maybe Word256 -> m [(Account, AddressState)]
getAllAddressStates chainId = getAllAddressStatesFromStateRoot chainId =<< getStateRoot chainId

getAllAddressStatesFromStateRoot :: (HasHashDB m, HasStateDB m) => Maybe Word256 -> MP.StateRoot -> m [(Account, AddressState)]
getAllAddressStatesFromStateRoot chainId sr = do
  mapM convert =<< MP.unsafeGetAllKeyVals sr
  where
    convert :: (HasHashDB m) => (N.NibbleString, RLPObject) -> m (Account, AddressState)
    convert (k, v) = do
      k' <- fmap (fromMaybe (error $ "missing key value in hash table: " ++ BC.unpack (B16.encode $ nibbleString2ByteString k))) $ getAddressFromHash k
      return ((Account k' chainId), rlpDecode . rlpDeserialize . rlpDecode $ v)

getAddressFromHash :: (HasHashDB m) => N.NibbleString -> m (Maybe Address)
getAddressFromHash =
  liftM (fmap addressFromNibbleString) . hashDBGet

getStorageKeyFromHash :: (HasHashDB m) => N.NibbleString -> m (Maybe Word256)
getStorageKeyFromHash = fmap (fmap bytesToWord256) . getRawStorageKeyFromHash

getRawStorageKeyFromHash :: (HasHashDB m) => N.NibbleString -> m (Maybe B.ByteString)
getRawStorageKeyFromHash = fmap (fmap nibbleString2ByteString) . hashDBGet

putAddressState :: (HasStateDB m, HasHashDB m) => Account -> AddressState -> m ()
putAddressState (Account address chainId) newState = do
  hashDBPut addrNibbles
  sr <- getStateRoot chainId
  sr' <- MP.putKeyVal sr addrNibbles $ rlpEncode $ rlpSerialize $ rlpEncode newState
  setStateDBStateRoot chainId sr'
  where
    addrNibbles = addressAsNibbleString address

deleteAddressState :: HasStateDB m => Account -> m ()
deleteAddressState (Account address chainId) = do
  sr <- getStateRoot chainId
  sr' <- MP.deleteKey sr (addressAsNibbleString address)
  setStateDBStateRoot chainId sr'

addressStateExists :: HasStateDB m => Account -> m Bool
addressStateExists (Account address chainId) = do
  sr <- getStateRoot chainId
  MP.keyExists sr (addressAsNibbleString address)
