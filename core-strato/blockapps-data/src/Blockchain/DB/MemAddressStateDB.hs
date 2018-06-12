{-# OPTIONS -fno-warn-redundant-constraints #-} -- todo fixme
module Blockchain.DB.MemAddressStateDB (
  HasMemAddressStateDB(..),
  AddressStateModification(..),
  formatAddressStateDBMap,
  getAddressState,
  putAddressState,
  flushMemAddressStateDB,
  getAllAddressStates,
  deleteAddressState,
  addressStateExists
) where

import           Control.Monad
import qualified Data.Map                       as M

import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import qualified Blockchain.DB.AddressStateDB   as DB
import           Blockchain.DB.HashDB
import           Blockchain.DB.StateDB
import           Blockchain.ExtWord             (Word256)
import           Blockchain.Format

data AddressStateModification = ASModification AddressState | ASDeleted deriving (Show)

instance Format AddressStateModification where
  format (ASModification addressState) = "Address Modified:\n" ++ format addressState
  format ASDeleted                     = "Address Deleted"

formatAddressStateDBMap :: M.Map (Maybe Word256, Address) AddressStateModification -> String
formatAddressStateDBMap theMap = unlines $
    map (\((c,a), am) -> show c ++ ", " ++ format a ++ ": " ++ format am)
     (M.toList theMap)

class HasMemAddressStateDB m where
  getAddressStateDBMap :: m (M.Map (Maybe Word256, Address) AddressStateModification)
  putAddressStateDBMap :: M.Map (Maybe Word256, Address) AddressStateModification -> m ()

getAddressState :: (HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
                 Maybe Word256 -> Address -> m AddressState
getAddressState chainId address = do
  theMap <- getAddressStateDBMap
  case M.lookup (chainId, address) theMap of
    Just (ASModification addressState) -> return addressState
    Just ASDeleted                     -> return blankAddressState
    Nothing                            -> DB.getAddressState chainId address

getAllAddressStates::(HasMemAddressStateDB m, HasHashDB m, HasStateDB m)=>
                     m [(Maybe Word256, Address, AddressState)]
getAllAddressStates = DB.getAllAddressStates

putAddressState :: (HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
                 Maybe Word256 -> Address -> AddressState -> m ()
putAddressState chainId address newState = do
  theMap <- getAddressStateDBMap
  putAddressStateDBMap (M.insert (chainId, address) (ASModification newState) theMap)

flushMemAddressStateDB::(HasMemAddressStateDB m, HasStateDB m, HasHashDB m)=>
                        m ()
flushMemAddressStateDB = do
  theMap <- getAddressStateDBMap
  forM_ (M.toList theMap) $ \((chainId, address), modification) -> do
                           case modification of
                             ASModification addressState -> DB.putAddressState chainId address addressState
                             ASDeleted                   -> DB.deleteAddressState chainId address
  putAddressStateDBMap M.empty

deleteAddressState :: (HasMemAddressStateDB m, HasStateDB m) =>
                    Maybe Word256 -> Address -> m ()
deleteAddressState chainId address = do
  theMap <- getAddressStateDBMap
  putAddressStateDBMap (M.insert (chainId, address) ASDeleted theMap)

addressStateExists :: (HasMemAddressStateDB m, HasStateDB m) =>
                    Maybe Word256 -> Address -> m Bool
addressStateExists chainId address = do
  theMap <- getAddressStateDBMap
  case M.lookup (chainId, address) theMap of
    Just (ASModification _) -> return True
    Just ASDeleted          -> return False
    Nothing                 -> DB.addressStateExists chainId address


--Dummy version of the functions useful for turning off caching in debug situations
{-
getAddressState::(HasMemAddressStateDB m, HasStateDB m, HasHashDB m)=>
                 Address->m AddressState
getAddressState address = DB.getAddressState address

getAllAddressStates::(HasMemAddressStateDB m, HasHashDB m, HasStateDB m)=>
                     m [(Address, AddressState)]
getAllAddressStates = DB.getAllAddressStates

putAddressState::(HasMemAddressStateDB m, HasStateDB m, HasHashDB m)=>
                 Address->AddressState->m ()
putAddressState address newState = DB.putAddressState address newState

deleteAddressState::(HasMemAddressStateDB m, HasStateDB m)=>Address->
                    m ()
deleteAddressState address = DB.deleteAddressState address

addressStateExists::(HasMemAddressStateDB m, HasStateDB m)=>Address->
                    m Bool
addressStateExists address = DB.addressStateExists address
-}
