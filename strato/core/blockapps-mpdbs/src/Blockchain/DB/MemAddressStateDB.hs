{-# OPTIONS -fno-warn-redundant-constraints #-} -- todo fixme
{-# LANGUAGE DeriveGeneric    #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell    #-}
{-# LANGUAGE TypeOperators    #-}
module Blockchain.DB.MemAddressStateDB (
  HasMemAddressStateDB(..),
  AddressStateModification(..),
  formatAddressStateDBMap,
  getAddressState,
  getAddressStateMaybe,
  putAddressState,
  flushMemAddressStateTxToBlockDB,
  flushMemAddressStateDB,
  getAllAddressStates,
  deleteAddressState,
  addressStateExists
) where

import           Control.Monad
import qualified Control.Monad.Change.Alter     as A
import           Control.DeepSeq
import           Data.Maybe
import qualified Data.Map                       as M
import qualified Data.Text                      as T
import GHC.Generics

import           BlockApps.Logging
import           Blockchain.Data.AddressStateDB
import qualified Blockchain.DB.AddressStateDB   as DB
import           Blockchain.DB.HashDB
import           Blockchain.DB.StateDB
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord
import           Text.Format

data AddressStateModification = ASModification AddressState | ASDeleted deriving (Show, Eq, Generic)

instance NFData AddressStateModification

instance Format AddressStateModification where
  format (ASModification addressState) = "Address Modified:\n" ++ format addressState
  format ASDeleted                     = "Address Deleted"

formatAddressStateDBMap :: M.Map Address AddressStateModification -> String
formatAddressStateDBMap theMap = unlines $
    map (\(a, am) -> format a ++ ": " ++ format am)
     (M.toList theMap)

class HasMemAddressStateDB m where
  getAddressStateTxDBMap    :: m (M.Map Account AddressStateModification)
  putAddressStateTxDBMap    :: M.Map Account AddressStateModification -> m ()
  getAddressStateBlockDBMap :: m (M.Map Account AddressStateModification)
  putAddressStateBlockDBMap :: M.Map Account AddressStateModification -> m ()

getAddressState :: (Account `A.Alters` AddressState) m => Account -> m AddressState
getAddressState account = fromMaybe blankAddressState <$> A.lookup A.Proxy account

getAddressStateMaybe :: (MonadLogger m, HasMemAddressStateDB m, HasStateDB m, HasHashDB m)
                     => Account -> m (Maybe AddressState)
getAddressStateMaybe account = do
  theMap <- getAddressStateTxDBMap
  case M.lookup account theMap of
    Just (ASModification addressState) -> do
      $logInfoS "getAddressStateMaybe" . T.pack $ "Found ASModification in tx map for " ++ format account ++ ": " ++ format addressState
      return $ Just addressState
    Just ASDeleted                     -> do
      $logInfoS "getAddressStateMaybe" . T.pack $ "Found ASDeleted in tx map for " ++ format account
      return $ Just blankAddressState
    Nothing                            -> do
      theBMap <- getAddressStateBlockDBMap
      case M.lookup account theBMap of
        Just (ASModification addressState) -> do
          $logInfoS "getAddressStateMaybe" . T.pack $ "Found ASModification in block map for " ++ format account ++ ": " ++ format addressState
          return $ Just addressState
        Just ASDeleted                     -> do
          $logInfoS "getAddressStateMaybe" . T.pack $ "Found ASDeleted in block map for " ++ format account
          return $ Just blankAddressState
        Nothing                            -> do
          mAddressState <- DB.getAddressStateMaybe account
          $logInfoS "getAddressStateMaybe" . T.pack $ "Address state for " ++ format account ++ " from database: " ++ format mAddressState
          pure mAddressState

getAllAddressStates::(HasMemAddressStateDB m, HasHashDB m, HasStateDB m)=>
                     Maybe Word256 -> m [(Account, AddressState)]
getAllAddressStates = DB.getAllAddressStates

putAddressState :: (MonadLogger m, HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
                 Account -> AddressState -> m ()
putAddressState account newState = do
  theMap <- getAddressStateTxDBMap
  $logInfoS "putAddressState" . T.pack $ "Putting address state for " ++ format account ++ ": " ++ format newState
  putAddressStateTxDBMap (M.insert account (ASModification newState) theMap)

flushMemAddressStateTxToBlockDB :: (HasMemAddressStateDB m, HasStateDB m, HasHashDB m) =>
                                m ()
flushMemAddressStateTxToBlockDB = do
  txMap <- getAddressStateTxDBMap
  blkMap <- getAddressStateBlockDBMap
  putAddressStateBlockDBMap $ txMap `M.union` blkMap
  putAddressStateTxDBMap M.empty

flushMemAddressStateDB::(HasMemAddressStateDB m, HasStateDB m, HasHashDB m)=>
                        m ()
flushMemAddressStateDB = do
  flushMemAddressStateTxToBlockDB
  theMap <- getAddressStateBlockDBMap
  forM_ (M.toList theMap) $ \(account, modification) -> do
                           case modification of
                             ASModification addressState -> DB.putAddressState account addressState
                             ASDeleted                   -> DB.deleteAddressState account
  putAddressStateBlockDBMap M.empty

deleteAddressState :: (HasMemAddressStateDB m, HasStateDB m) =>
                    Account -> m ()
deleteAddressState account = do
  theMap <- getAddressStateTxDBMap
  putAddressStateTxDBMap (M.insert account ASDeleted theMap)

addressStateExists :: (HasMemAddressStateDB m, HasStateDB m) =>
                    Account -> m Bool
addressStateExists account = do
  theMap <- getAddressStateTxDBMap
  case M.lookup account theMap of
    Just (ASModification _) -> return True
    Just ASDeleted          -> return False
    Nothing                 -> do
      theBMap <- getAddressStateBlockDBMap
      case M.lookup account theBMap of
        Just (ASModification _) -> return True
        Just ASDeleted          -> return False
        Nothing                 -> DB.addressStateExists account
