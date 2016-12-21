{-# LANGUAGE FlexibleContexts, DataKinds, TypeFamilies, NamedFieldPuns #-}

module Blockchain.Data.DiffDB (
  sqlDiff, commitSqlDiffs 
  ) where

import Database.Persist hiding (get, Update)
import qualified Database.Persist.Postgresql as SQL hiding (get, Update)

import Blockchain.Database.MerklePatricia.Internal
import Blockchain.Data.Address
import Blockchain.Data.DataDefs
import Blockchain.Data.StateDiff
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.SQLDB
import Blockchain.DB.StateDB
import Blockchain.ExtWord
import Blockchain.Util
import Blockchain.SHA

import Control.Monad.Trans.Resource

import Data.Map (Map)
import qualified Data.Map as Map

type SqlDbM m = SQL.SqlPersistT m

sqlDiff :: (HasSQLDB m, HasCodeDB m, HasStateDB m, HasHashDB m, MonadResource m, MonadBaseControl IO m)=>
           Integer -> SHA -> StateRoot -> StateRoot -> m ()
sqlDiff blockNumber blockHash oldRoot newRoot = do
  stateDiffs <- stateDiff blockNumber blockHash oldRoot newRoot 
  commitSqlDiffs stateDiffs

commitSqlDiffs :: (HasStateDB m, HasHashDB m, HasCodeDB m, HasSQLDB m, MonadResource m, MonadBaseControl IO m)=>
                  StateDiff -> m ()
commitSqlDiffs StateDiff{blockNumber, createdAccounts, deletedAccounts, updatedAccounts} = do
  pool <- getSQLDB
  flip SQL.runSqlPool pool $ do
    sequence_ $ Map.mapWithKey (createAccount blockNumber) createdAccounts
    sequence_ $ Map.mapWithKey (const . deleteAccount) deletedAccounts
    sequence_ $ Map.mapWithKey (updateAccount blockNumber) updatedAccounts

createAccount :: (HasStateDB m, HasHashDB m, HasCodeDB m, MonadResource m, MonadBaseControl IO m) =>
                 Integer -> Address -> AccountDiff 'Eventual -> SQL.SqlPersistT m ()
createAccount blockNumber address diff = do
  addrID <- SQL.insert addrRef
  sequence_ $ Map.mapWithKey (commitStorage addrID) $ Map.map makeIncremental $ storage diff

  where 
    addrRef = AddressStateRef{
      addressStateRefAddress = address, 
      addressStateRefNonce = getField (theError "nonce") $ nonce diff,
      addressStateRefBalance = getField (theError "balance") $ balance diff,
      addressStateRefContractRoot = getField (theError "contractRoot") $ contractRoot diff,
      addressStateRefCode = getField (theError "code") $ code diff,
      addressStateRefCodeHash = codeHash diff,
      addressStateRefLatestBlockDataRefNumber = blockNumber
      }
    makeIncremental (Value x) = Create{newValue = x}
    theError :: String -> a
    theError name = error $
      "Missing field '" ++ name ++ 
      "' in contract creation diff for address " ++ formatAddressWithoutColor address

getField :: a -> Maybe (Diff a 'Eventual) -> a
getField def field = 
  case field of 
    Just (Value x) -> x
    Nothing -> def

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
    takeIncremental Delete{} = 0
    takeIncremental Update{newValue} = newValue

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

getAddressStateSQL :: (HasStateDB m, HasHashDB m, MonadResource m)=>Address -> String -> SqlDbM m (SQL.Key AddressStateRef)
getAddressStateSQL addr' s = do
  addrIDs <- SQL.selectKeysList
              [ AddressStateRefAddress SQL.==. addr' ] [ LimitTo 1 ]
  if null addrIDs
    then error $ s ++ ": Address not found in SQL db: " ++ formatAddressWithoutColor addr'
    else return $ head addrIDs

getStorageKeySQL :: (HasStateDB m, HasHashDB m, MonadResource m)=>(SQL.Key AddressStateRef) -> Word256 -> String -> SqlDbM m (SQL.Key Storage)
getStorageKeySQL addrID storageKey' s = do
  storageIDs <- SQL.selectKeysList
              [ StorageAddressStateRefId SQL.==. addrID, StorageKey SQL.==. storageKey' ]
              [ LimitTo 1 ]
  if null storageIDs
    then error $ s ++ ": Storage key not found in SQL db: " ++ showHex4 storageKey'
    else return $ head storageIDs
