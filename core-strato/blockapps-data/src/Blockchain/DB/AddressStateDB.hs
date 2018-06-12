{-# LANGUAGE EmptyDataDecls             #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE ForeignFunctionInterface   #-}
{-# LANGUAGE GADTs                      #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}
{-# OPTIONS_GHC -fno-warn-orphans       #-}

--TODO : Take this next line out
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.DB.AddressStateDB (
  getAddressState,
  getAllAddressStates,
  putAddressState,
  deleteAddressState,
  addressStateExists,
  getAddressFromHash,
  getStorageKeyFromHash
) where

import           Blockchain.Data.Address
import           Blockchain.Data.ChainId                     hiding (ChainId)

import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia          as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import           Blockchain.DB.HashDB
import           Blockchain.DB.StateDB
import           Blockchain.ExtWord
import           Blockchain.Util

import           Data.Binary
import           Data.Binary.Get                             (runGet)
import qualified Data.ByteString.Base16                      as B16
import qualified Data.ByteString.Char8                       as BC
import qualified Data.ByteString.Lazy                        as BL
import           Data.Maybe

import           Control.Monad                               (liftM)
import           Control.Monad.Trans.Resource

import qualified Data.NibbleString                           as N

getKey :: Maybe Word256 -> Address -> N.NibbleString
getKey chainId address = chainIdAsNibbleString chainId `N.append` addressAsNibbleString address

getChainIdAndAddress :: N.NibbleString -> (Maybe Word256, Address)
getChainIdAndAddress n | N.length n == 40 = addressFromNibbleString <$> (Nothing, n)
                       | N.length n == 104 = flip runGet (BL.fromStrict $ nibbleString2ByteString n) $ do
                                               chainId <- get
                                               address <- get
                                               return (Just chainId, Address address)
                       | otherwise         = error $ "getChainIdAndAddress: Incorrectly length NibbleString. Expected 40 or 104 nibbles, got " ++ (show $ N.length n)

getAddressState :: (HasStateDB m, HasHashDB m) => Maybe Word256 -> Address -> m AddressState
getAddressState chainId address = do
    db <- getStateDB
    let key = getKey chainId address
    states <- MP.getKeyVal db key

    case states of
      Nothing -> do
        -- Querying an absent state counts as initializing it.
        --TODO- decide if this is needed
        --putAddressState address b
        return b
        where b = blankAddressState
      Just s -> return $ (rlpDecode . rlpDeserialize . rlpDecode) s

getAllAddressStates::(HasHashDB m, HasStateDB m, MonadResource m) => m [(Maybe Word256, Address, AddressState)]
getAllAddressStates = do
  sdb <- getStateDB
  mapM convert =<<  MP.unsafeGetAllKeyVals sdb
  where
    convert :: (HasHashDB m, MonadResource m) => (N.NibbleString, RLPObject) -> m (Maybe Word256, Address, AddressState)
    convert (k, v) = do
      (c',k') <- fmap (fromMaybe (error $ "missing key value in hash table: " ++ BC.unpack (B16.encode $ nibbleString2ByteString k))) $ getAddressFromHash k
      return (c', k', rlpDecode . rlpDeserialize . rlpDecode $ v)

getAddressFromHash::(HasHashDB m, MonadResource m)=>N.NibbleString -> m (Maybe (Maybe Word256, Address))
getAddressFromHash =
  liftM (fmap getChainIdAndAddress) . hashDBGet

getStorageKeyFromHash::(HasHashDB m, MonadResource m)=>N.NibbleString -> m (Maybe Word256)
getStorageKeyFromHash  =
  liftM (fmap (decode . BL.fromStrict . nibbleString2ByteString) ) . hashDBGet

putAddressState :: (HasStateDB m, HasHashDB m) => Maybe Word256 -> Address -> AddressState -> m ()
putAddressState chainId address newState = do
  hashDBPut addrNibbles
  db <- getStateDB
  db' <- MP.putKeyVal db addrNibbles $ rlpEncode $ rlpSerialize $ rlpEncode newState
  setStateDBStateRoot (MP.stateRoot db')
  where addrNibbles = getKey chainId address

deleteAddressState :: HasStateDB m => Maybe Word256 -> Address -> m ()
deleteAddressState chainId address = do
  db <- getStateDB
  db' <- MP.deleteKey db (getKey chainId address)
  setStateDBStateRoot $ MP.stateRoot db'

addressStateExists :: HasStateDB m => Maybe Word256 -> Address -> m Bool
addressStateExists chainId address = do
  db <- getStateDB
  MP.keyExists db (getKey chainId address)
