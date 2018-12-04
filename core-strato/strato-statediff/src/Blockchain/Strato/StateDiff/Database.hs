{-# LANGUAGE DataKinds        #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE NamedFieldPuns   #-}
{-# LANGUAGE TypeFamilies     #-}

module Blockchain.Strato.StateDiff.Database
    ( sqlDiff
    , commitSqlDiffs
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
import           Control.Monad.Trans.Resource
import qualified Data.Map                                    as Map

import           Blockchain.Strato.StateDiff

type SqlDbM m = SQL.SqlPersistT m

sqlDiff :: (HasSQLDB m, HasCodeDB m, HasStateDB m, HasHashDB m, MonadResource m)=>
           Maybe Word256 -> Integer -> SHA -> StateRoot -> StateRoot -> m ()
sqlDiff chainId blockNumber blockHash oldRoot newRoot = do
  stateDiffs <- stateDiff chainId blockNumber blockHash oldRoot newRoot
  commitSqlDiffs stateDiffs

commitSqlDiffs :: (HasSQLDB m, MonadResource m)=>
                  StateDiff -> m ()
commitSqlDiffs StateDiff{chainId, blockNumber, createdAccounts, deletedAccounts, updatedAccounts} = do
  pool <- getSQLDB
  flip SQL.runSqlPool pool $ do
    createAccount chainId blockNumber $ Map.toList createdAccounts
    sequence_ $ Map.mapWithKey (const . deleteAccount chainId) deletedAccounts
    sequence_ $ Map.mapWithKey (updateAccount chainId blockNumber) updatedAccounts

createAccount :: MonadIO m =>
                 Maybe Word256 -> Integer -> [(Address, AccountDiff 'Eventual)] -> SQL.SqlPersistT m ()
createAccount chainId blockNumber addressDiffs = do
  newAccounts <- forM addressDiffs $ \addressDiff -> do
    let (address, diff) = addressDiff
    return $ addrRef address diff
  addrIDs <- SQL.insertMany newAccounts

  newStorage <-
    forM (zip addressDiffs addrIDs) $ \(addressDiff, addrID) -> do
      let (_, diff) = addressDiff
      return [Storage addrID k v | (k, Value v) <- Map.toList $ storage diff]
  SQL.insertMany_ $ concat newStorage

  where
    addrRef address diff = AddressStateRef{
      addressStateRefAddress = address,
      addressStateRefNonce = getField (theError address "nonce") $ nonce diff,
      addressStateRefBalance = getField (theError address "balance") $ balance diff,
      addressStateRefContractRoot = getField (theError address "contractRoot") $ contractRoot diff,
      addressStateRefCode = getField (theError address "code") $ code diff,
      addressStateRefCodeHash = codeHash diff,
      addressStateRefLatestBlockDataRefNumber = blockNumber,
      addressStateRefChainId = chainId
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

deleteAccount :: MonadResource m =>
                 Maybe Word256 -> Address -> SQL.SqlPersistT m ()
deleteAccount chainId address = do
  addrID <- getAddressStateSQL chainId address "delete"
  SQL.deleteWhere [ StorageAddressStateRefId SQL.==. addrID ]
  SQL.delete addrID

updateAccount :: (MonadResource m, MonadBaseControl IO m) =>
                 Maybe Word256 -> Integer -> Address -> AccountDiff 'Incremental -> SQL.SqlPersistT m ()
updateAccount chainId blockNumber address diff = do
  addrID <- getAddressStateSQL chainId address "update"
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

commitStorage :: MonadResource m =>
                 SQL.Key AddressStateRef -> Word256 -> Diff Word256 'Incremental -> SqlDbM m ()
commitStorage addrID key Create{newValue} =
  SQL.insert_ $ Storage addrID key newValue

commitStorage addrID key Delete{} = do
  storageID <- getStorageKeySQL addrID key "delete"
  SQL.delete storageID

commitStorage addrID key Update{newValue} = do
  storageID <- getStorageKeySQL addrID key "update"
  SQL.update storageID [ StorageValue =. newValue ]

getAddressStateSQL :: MonadResource m
                   => Maybe Word256
                   -> Address
                   -> String
                   -> SqlDbM m (SQL.Key AddressStateRef)
getAddressStateSQL chainId addr' s = do
  addrIDs <- SQL.selectKeysList
              [ AddressStateRefAddress SQL.==. addr' , AddressStateRefChainId SQL.==. chainId ] [ LimitTo 1 ]
  if null addrIDs
    then error $ s ++ ": Address not found in SQL db: " ++ formatAddressWithoutColor addr' ++ " with chain Id " ++ show chainId
    else return $ head addrIDs

getStorageKeySQL :: MonadResource m
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
