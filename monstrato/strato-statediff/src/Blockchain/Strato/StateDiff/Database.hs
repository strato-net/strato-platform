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

import           Control.Monad.Trans.Class                   (lift)
import           Control.Monad.Trans.Resource
import qualified Data.Map                                    as Map

import           Blockchain.Strato.StateDiff

type SqlDbM m = SQL.SqlPersistT m

sqlDiff :: (HasSQLDB m, HasCodeDB m, HasStateDB m, HasHashDB m, MonadResource m, MonadBaseControl IO m)=>
           Maybe Word256 -> Integer -> SHA -> StateRoot -> StateRoot -> m ()
sqlDiff chainId blockNumber blockHash oldRoot newRoot = do
  stateDiffs <- stateDiff chainId blockNumber blockHash oldRoot newRoot
  commitSqlDiffs stateDiffs (const (return "")) (const (return ""))

commitSqlDiffs :: (HasStateDB m, HasHashDB m, HasCodeDB m, HasSQLDB m, MonadResource m, MonadBaseControl IO m)=>
                  StateDiff -> (Address -> m String) -> (Address -> m String) -> m ()
commitSqlDiffs StateDiff{chainId, blockNumber, createdAccounts, deletedAccounts, updatedAccounts} addressSource addressContractName = do
  pool <- getSQLDB
  flip SQL.runSqlPool pool $ do
    sequence_ $ Map.mapWithKey (createAccount chainId blockNumber addressSource addressContractName) createdAccounts
    sequence_ $ Map.mapWithKey (const . deleteAccount chainId) deletedAccounts
    sequence_ $ Map.mapWithKey (updateAccount chainId blockNumber) updatedAccounts

createAccount :: (HasStateDB m, HasHashDB m, HasCodeDB m, MonadResource m, MonadBaseControl IO m) =>
                 Maybe Word256 -> Integer -> (Address -> m String) -> (Address -> m String) -> Address -> AccountDiff 'Eventual -> SQL.SqlPersistT m ()
createAccount chainId blockNumber addressSource addressContractName address diff = do
  src <- lift $ addressSource address
  name' <- lift $ addressContractName address
  addrID <- SQL.insert (addrRef src name')
  sequence_ $ Map.mapWithKey (commitStorage addrID) $ Map.map makeIncremental $ storage diff

  where
    addrRef source name = AddressStateRef{
      addressStateRefAddress = address,
      addressStateRefNonce = getField (theError "nonce") $ nonce diff,
      addressStateRefBalance = getField (theError "balance") $ balance diff,
      addressStateRefContractRoot = getField (theError "contractRoot") $ contractRoot diff,
      addressStateRefCode = getField (theError "code") $ code diff,
      addressStateRefCodeHash = codeHash diff,
      addressStateRefLatestBlockDataRefNumber = blockNumber,
      addressStateRefSource = source,
      addressStateRefContractName = name,
      addressStateRefChainId = chainId
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
    Nothing        -> def

deleteAccount :: (HasStateDB m, HasHashDB m, HasCodeDB m, MonadResource m, MonadBaseControl IO m) =>
                 Maybe Word256 -> Address -> SQL.SqlPersistT m ()
deleteAccount chainId address = do
  addrID <- getAddressStateSQL chainId address "delete"
  SQL.deleteWhere [ StorageAddressStateRefId SQL.==. addrID ]
  SQL.delete addrID

updateAccount :: (HasStateDB m, HasHashDB m, HasCodeDB m, MonadResource m, MonadBaseControl IO m) =>
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

updateSource :: (HasStateDB m, HasHashDB m, HasCodeDB m, HasSQLDB m, MonadResource m, MonadBaseControl IO m) =>
                Maybe Word256 -> Address -> String -> String -> m ()
updateSource chainId address name source = do
  pool <- getSQLDB
  flip SQL.runSqlPool pool $ do
    addrID <- getAddressStateSQL chainId address "update"
    SQL.update addrID [ AddressStateRefSource =. source
                      , AddressStateRefContractName =. name
                      , AddressStateRefChainId =. chainId
                      ]

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
