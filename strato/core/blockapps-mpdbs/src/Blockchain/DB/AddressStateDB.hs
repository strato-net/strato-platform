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
  ( getAddressStateMaybe,
    getAllAddressStates,
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
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Util
import Control.Monad (liftM)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Maybe
import qualified Data.NibbleString as N

getAddressStateMaybe :: HasStateDB m => Address -> m (Maybe AddressState)
getAddressStateMaybe address = do
  sr <- getStateRoot Nothing
  mState <- MP.getKeyVal sr $ addressAsNibbleString address
  return $ rlpDecode . rlpDeserialize . rlpDecode <$> mState

getAllAddressStates :: (HasHashDB m, HasStateDB m) => m [(Address, AddressState)]
getAllAddressStates = getAllAddressStatesFromStateRoot =<< getStateRoot Nothing

getAllAddressStatesFromStateRoot :: (HasHashDB m, HasStateDB m) => MP.StateRoot -> m [(Address, AddressState)]
getAllAddressStatesFromStateRoot sr = do
  mapM convert =<< MP.unsafeGetAllKeyVals sr
  where
    convert :: (HasHashDB m) => (N.NibbleString, RLPObject) -> m (Address, AddressState)
    convert (k, v) = do
      k' <- fmap (fromMaybe (error $ "missing key value in hash table: " ++ BC.unpack (B16.encode $ nibbleString2ByteString k))) $ getAddressFromHash k
      return (k', rlpDecode . rlpDeserialize . rlpDecode $ v)

getAddressFromHash :: (HasHashDB m) => N.NibbleString -> m (Maybe Address)
getAddressFromHash =
  liftM (fmap addressFromNibbleString) . hashDBGet

getStorageKeyFromHash :: (HasHashDB m) => N.NibbleString -> m (Maybe Word256)
getStorageKeyFromHash = fmap (fmap bytesToWord256) . getRawStorageKeyFromHash

getRawStorageKeyFromHash :: (HasHashDB m) => N.NibbleString -> m (Maybe B.ByteString)
getRawStorageKeyFromHash = fmap (fmap nibbleString2ByteString) . hashDBGet

putAddressState :: (HasStateDB m, HasHashDB m) => Address -> AddressState -> m ()
putAddressState address newState = do
  hashDBPut addrNibbles
  sr <- getStateRoot Nothing
  sr' <- MP.putKeyVal sr addrNibbles $ rlpEncode $ rlpSerialize $ rlpEncode newState
  setStateDBStateRoot Nothing sr'
  where
    addrNibbles = addressAsNibbleString address

deleteAddressState :: HasStateDB m => Address -> m ()
deleteAddressState address = do
  sr <- getStateRoot Nothing
  sr' <- MP.deleteKey sr (addressAsNibbleString address)
  setStateDBStateRoot Nothing sr'

addressStateExists :: HasStateDB m => Address -> m Bool
addressStateExists address = do
  sr <- getStateRoot Nothing
  MP.keyExists sr (addressAsNibbleString address)
