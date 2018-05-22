{-# LANGUAGE DataKinds        #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE NamedFieldPuns   #-}
{-# LANGUAGE TypeFamilies     #-}

module Blockchain.Strato.StateDiff.Database
    ( sqlDiff
    , commitSqlDiffs
    , updateSource
    ) where

import           Database.Persist                            hiding (Update, get)
import qualified Database.Persist.Postgresql                 as SQL hiding (Update, get)

import           Blockchain.Data.Address
import           Blockchain.Data.DataDefs
import           Blockchain.Database.MerklePatricia.Internal
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.ExtWord
import           Blockchain.SHA
import           Blockchain.Util

import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Class                   (lift)
import           Control.Monad.Trans.Resource
import qualified Data.Map                                    as Map
import Data.Time.Clock
import Data.Time.Clock.POSIX

import           Blockchain.Strato.StateDiff

type SqlDbM m = SQL.SqlPersistT m

sqlDiff :: (HasSQLDB m, HasCodeDB m, HasStateDB m, HasHashDB m, MonadResource m, MonadBaseControl IO m)=>
           Integer -> SHA -> StateRoot -> StateRoot -> m ()
sqlDiff blockNumber blockHash oldRoot newRoot = do
  stateDiffs <- stateDiff blockNumber blockHash oldRoot newRoot
  commitSqlDiffs stateDiffs (const "") (const "")

commitSqlDiffs :: (HasStateDB m, HasHashDB m, HasCodeDB m, HasSQLDB m, MonadResource m, MonadBaseControl IO m)=>
                  StateDiff -> (SHA -> String) -> (SHA -> String) -> m ()
commitSqlDiffs StateDiff{blockNumber, createdAccounts, deletedAccounts, updatedAccounts} codeSource codeContractName = do
  pool <- getSQLDB
  flip SQL.runSqlPool pool $ do
    createAccount blockNumber codeSource codeContractName $ Map.toList createdAccounts
    sequence_ $ Map.mapWithKey (const . deleteAccount) deletedAccounts
    sequence_ $ Map.mapWithKey (updateAccount blockNumber) updatedAccounts

createAccount :: MonadIO m =>
                 Integer -> (SHA -> String) -> (SHA -> String) -> [(Address, AccountDiff 'Eventual)] -> SQL.SqlPersistT m ()
createAccount blockNumber codeSource codeContractName addressDiffs = do
  newAccounts <- forM addressDiffs $ \addressDiff -> do
    let (address, diff) = addressDiff
        src = codeSource $ codeHash diff
        name' = codeContractName $ codeHash diff
    return $ addrRef address diff src name'
  addrIDs <- SQL.insertMany newAccounts
  
  newStorage <- 
    forM (zip addressDiffs addrIDs) $ \(addressDiff, addrID) -> do
      let (_, diff) = addressDiff
      return [Storage addrID k v | (k, Value v) <- Map.toList $ storage diff]
  SQL.insertMany_ $ concat newStorage

  where
    addrRef address diff source name = AddressStateRef{
      addressStateRefAddress = address,
      addressStateRefNonce = getField (theError address "nonce") $ nonce diff,
      addressStateRefBalance = getField (theError address "balance") $ balance diff,
      addressStateRefContractRoot = getField (theError address "contractRoot") $ contractRoot diff,
      addressStateRefCode = getField (theError address "code") $ code diff,
      addressStateRefCodeHash = codeHash diff,
      addressStateRefLatestBlockDataRefNumber = blockNumber,
      addressStateRefSource = source,
      addressStateRefContractName = name
      }
    theError :: Address -> String -> a
    theError address name = error $
      "Missing field '" ++ name ++
      "' in contract creation diff for address " ++ formatAddressWithoutColor address

getField :: a -> Maybe (Diff a 'Eventual) -> a
getField def field =
  case field of
    Just (Value x) -> x
    Nothing        -> def

deleteAccount :: (HasStateDB m, HasHashDB m, HasCodeDB m, MonadResource m, MonadBaseControl IO m) =>
                 Address -> SQL.SqlPersistT m ()
deleteAccount address = do
  addrID <- getAddressStateSQL address "delete"
  SQL.deleteWhere [ StorageAddressStateRefId SQL.==. addrID ]
  SQL.delete addrID

updateAccount :: (HasStateDB m, HasHashDB m, HasCodeDB m, MonadResource m, MonadBaseControl IO m) =>
                 Integer -> Address -> AccountDiff 'Incremental -> SQL.SqlPersistT m ()
updateAccount blockNumber address diff = do
  addrID <- getAddressStateSQL address "update"
  SQL.update addrID $
    setField nonce AddressStateRefNonce $
    setField balance AddressStateRefBalance $
      [AddressStateRefLatestBlockDataRefNumber =. blockNumber]
  sequence_ $ Map.mapWithKey (commitStorage addrID) $ storage diff

  where
    setField field sqlField = maybe id (\v -> ((sqlField =. takeIncremental v) :)) $ field diff
    takeIncremental Create{newValue} = newValue
    takeIncremental Delete{}         = 0
    takeIncremental Update{newValue} = newValue

updateSource :: (HasStateDB m, HasHashDB m, HasCodeDB m, HasSQLDB m, MonadResource m, MonadBaseControl IO m) =>
                Address -> String -> String -> m ()
updateSource address name source = do
  pool <- getSQLDB
  flip SQL.runSqlPool pool $ do
    addrID <- getAddressStateSQL address "update"
    SQL.update addrID [AddressStateRefSource =. source,
                       AddressStateRefContractName =. name]

commitStorage :: (HasStateDB m, HasHashDB m, MonadResource m) =>
                 SQL.Key AddressStateRef -> Word256 -> Diff Word256 'Incremental -> SqlDbM m ()

commitStorage addrID key Create{newValue} =
  SQL.insert_ $ Storage addrID key newValue

commitStorage addrID key Delete{} = do
  storageID <- getStorageKeySQL addrID key "delete"
  SQL.delete storageID

commitStorage addrID key Update{newValue} = do
  storageID <- getStorageKeySQL addrID key "update"
  SQL.update storageID [ StorageValue =. newValue ]

getAddressStateSQL :: (HasStateDB m, HasHashDB m, MonadResource m)
                   => Address
                   -> String
                   -> SqlDbM m (SQL.Key AddressStateRef)
getAddressStateSQL addr' s = do
  addrIDs <- SQL.selectKeysList
              [ AddressStateRefAddress SQL.==. addr' ] [ LimitTo 1 ]
  if null addrIDs
    then error $ s ++ ": Address not found in SQL db: " ++ formatAddressWithoutColor addr'
    else return $ head addrIDs

getStorageKeySQL :: (HasStateDB m, HasHashDB m, MonadResource m)
                 => SQL.Key AddressStateRef
                 -> Word256
                 -> String
                 -> SqlDbM m (SQL.Key Storage)
getStorageKeySQL addrID storageKey' s = do
  storageIDs <- SQL.selectKeysList
              [ StorageAddressStateRefId SQL.==. addrID, StorageKey SQL.==. storageKey' ]
              [ LimitTo 1 ]
  if null storageIDs
    then error $ s ++ ": Storage key not found in SQL db: " ++ showHex4 storageKey'
    else return $ head storageIDs
