{-# LANGUAGE OverloadedStrings, ForeignFunctionInterface #-}
{-# LANGUAGE EmptyDataDecls             #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE FlexibleInstances          #-}
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

import Blockchain.Data.Address

import Blockchain.ExtWord
import Blockchain.Data.AddressStateDB
import Blockchain.Data.RLP
import Blockchain.DB.HashDB
import Blockchain.DB.StateDB
import Blockchain.Util
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MP

import Data.Binary
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.Maybe

import Control.Monad.State as ST
import Control.Monad.Trans.Resource
       
import qualified Data.NibbleString as N

getAddressState::(HasStateDB m, HasHashDB m)=>Address->m AddressState
getAddressState address = do
    db <- getStateDB
    states <- MP.getKeyVal db $ addressAsNibbleString address

    case states of
      Nothing -> do
        -- Querying an absent state counts as initializing it.
        --TODO- decide if this is needed
        --putAddressState address b
        return b
        where b = blankAddressState
      Just s -> return $ (rlpDecode . rlpDeserialize . rlpDecode) s
        
getAllAddressStates::(HasHashDB m, HasStateDB m, MonadResource m)=>m [(Address, AddressState)]
getAllAddressStates = do
  sdb <- getStateDB
  mapM convert =<<  MP.unsafeGetAllKeyVals sdb
  where
    convert::(HasHashDB m, MonadResource m)=>(N.NibbleString, RLPObject)-> m (Address, AddressState)
    convert (k, v) = do
      k' <- fmap (fromMaybe (error $ "missing key value in hash table: " ++ BC.unpack (B16.encode $ nibbleString2ByteString k))) $ getAddressFromHash k
      return (k', rlpDecode . rlpDeserialize . rlpDecode $ v)

getAddressFromHash::(HasHashDB m, MonadResource m)=>N.NibbleString -> m (Maybe Address)
getAddressFromHash =
  liftM (fmap addressFromNibbleString) . hashDBGet

getStorageKeyFromHash::(HasHashDB m, MonadResource m)=>N.NibbleString -> m (Maybe Word256)
getStorageKeyFromHash  =
  liftM (fmap (decode . BL.fromStrict . nibbleString2ByteString) ) . hashDBGet  

putAddressState::(HasStateDB m, HasHashDB m)=>Address->AddressState->m ()
putAddressState address newState = do
  hashDBPut addrNibbles
  db <- getStateDB
  db' <- MP.putKeyVal db addrNibbles $ rlpEncode $ rlpSerialize $ rlpEncode newState
  setStateDBStateRoot (MP.stateRoot db')
  where addrNibbles = addressAsNibbleString address

deleteAddressState::HasStateDB m=>Address->m ()
deleteAddressState address = do
  db <- getStateDB
  db' <- MP.deleteKey db (addressAsNibbleString address)
  setStateDBStateRoot $ MP.stateRoot db'

addressStateExists::HasStateDB m=>Address->m Bool
addressStateExists address = do
  db <- getStateDB
  MP.keyExists db (addressAsNibbleString address)
