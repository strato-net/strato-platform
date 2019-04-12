{-# LANGUAGE DataKinds        #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase       #-}
{-# LANGUAGE NamedFieldPuns   #-}
{-# LANGUAGE TypeFamilies     #-}

module Blockchain.Strato.StateDiff.Database
    ( sqlDiff
    , commitSqlDiffs
    ) where

import           Database.Persist                            hiding (Update, get)
import qualified Database.Persist.Postgresql                 as SQL hiding (Update, get)

import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.DataDefs
import           Blockchain.Database.MerklePatricia.Internal
import           Blockchain.Database.MerklePatricia.StateRoot (emptyTriePtr)
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.ExtWord
import           Blockchain.SHA
import           Blockchain.SolidVM.Model

import           Control.Monad
import           Control.Monad.IO.Class
import qualified Data.ByteString                             as BS
import           Data.Foldable                               (for_)
import qualified Data.Map                                    as Map
import           Data.Maybe

import           Blockchain.Strato.StateDiff

type SqlDbM m = SQL.SqlPersistT m

sqlDiff :: (HasSQLDB m, HasCodeDB m, HasStateDB m, HasHashDB m)=>
           Maybe Word256 -> Integer -> SHA -> StateRoot -> StateRoot -> m ()
sqlDiff chainId blockNumber blockHash oldRoot newRoot = do
  stateDiffs <- stateDiff chainId blockNumber blockHash oldRoot newRoot
  commitSqlDiffs stateDiffs

commitSqlDiffs :: HasSQLDB m => StateDiff -> m ()
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
      case storage diff of
        EVMDiff m -> return [Storage addrID EVM (word256ToHexStorage k) (word256ToHexStorage v)
                            | (k, Value v) <- Map.toList m]
        SolidVMDiff m -> return [Storage addrID SolidVM (HexStorage k) (HexStorage v)
                                | (k, Value v) <- Map.toList m]
  SQL.insertMany_ $ concat newStorage

  where
    addrRef address diff = AddressStateRef{
      addressStateRefAddress = address,
      addressStateRefNonce = getField (theError address "nonce") $ nonce diff,
      addressStateRefBalance = getField (theError address "balance") $ balance diff,
      addressStateRefContractRoot = getField (theError address "contractRoot") $ contractRoot diff,
      addressStateRefCode = getField (theError address "code") $ code diff,
      addressStateRefCodeHash =
          case codeHash diff of
            SolidVMCode _ ch -> ch
            EVMCode ch -> ch,
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

deleteAccount :: MonadIO m => Maybe Word256 -> Address -> SQL.SqlPersistT m ()
deleteAccount chainId address = do
  mAddrID <- getAddressStateSQL chainId address
  for_ mAddrID $ \addrID -> do
    SQL.deleteWhere [ StorageAddressStateRefId SQL.==. addrID ]
    SQL.delete addrID

updateAccount :: MonadIO m =>
                 Maybe Word256 -> Integer -> Address -> AccountDiff 'Incremental -> SQL.SqlPersistT m ()
updateAccount chainId blockNumber address diff = do
  mAddrID <- getAddressStateSQL chainId address
  case mAddrID of
    Nothing ->
      let eDiff = incrementalToEventual diff
          nonce'        = Just . fromMaybe (Value 0) $ nonce eDiff
          balance'      = Just . fromMaybe (Value 0) $ balance eDiff
          contractRoot' = Just . fromMaybe (Value emptyTriePtr) $ contractRoot eDiff
          code'         = Just . fromMaybe (Value BS.empty) $ code eDiff
          eDiff' = eDiff { nonce = nonce'
                         , balance = balance'
                         , contractRoot = contractRoot'
                         , code = code'
                         }
       in createAccount chainId blockNumber [(address, eDiff')]
    Just addrID -> do
      SQL.update addrID $
        setField nonce AddressStateRefNonce $
        setField balance AddressStateRefBalance $
          [AddressStateRefLatestBlockDataRefNumber =. blockNumber]
      case storage diff of
        EVMDiff m -> sequence_ $ Map.mapWithKey (commitStorage addrID) m
        SolidVMDiff m2 -> sequence_ $ Map.mapWithKey (commitSolidStorage addrID) m2

  where
    setField field sqlField = maybe id (\v -> ((sqlField =. takeIncremental v) :)) $ field diff
    takeIncremental Create{newValue} = newValue
    takeIncremental Delete{}         = 0
    takeIncremental Update{newValue} = newValue

commitStorage :: MonadIO m =>
                 SQL.Key AddressStateRef -> Word256 -> Diff Word256 'Incremental -> SqlDbM m ()
commitStorage addrID key = \case
  Create{newValue} ->
    SQL.insert_ $ Storage addrID EVM (word256ToHexStorage key) (word256ToHexStorage newValue)
  Delete{} -> do
    storageID <- getStorageKeySQL addrID (word256ToHexStorage key) "delete"
    SQL.delete storageID
  Update{newValue} -> do
    storageID <- getStorageKeySQL addrID (word256ToHexStorage key) "update"
    SQL.update storageID [ StorageValue =. (word256ToHexStorage newValue) ]

commitSolidStorage :: MonadIO m =>
                      SQL.Key AddressStateRef -> BS.ByteString -> Diff BS.ByteString 'Incremental -> SqlDbM m ()
commitSolidStorage addrID key = \case
  Create{newValue} ->
    SQL.insert_ $ Storage addrID SolidVM (HexStorage key) (HexStorage newValue)
  Delete{} -> do
    storageID <- getStorageKeySQL addrID (HexStorage key) "delete"
    SQL.delete storageID
  Update{newValue} -> do
    storageID <- getStorageKeySQL addrID (HexStorage key) "update"
    SQL.update storageID [ StorageValue =. HexStorage newValue ]

getAddressStateSQL :: MonadIO m
                   => Maybe Word256
                   -> Address
                   -> SqlDbM m (Maybe (SQL.Key AddressStateRef))
getAddressStateSQL chainId addr' = do
  addrIDs <- SQL.selectKeysList
              [ AddressStateRefAddress SQL.==. addr' , AddressStateRefChainId SQL.==. chainId ] [ LimitTo 1 ]
  return $ listToMaybe addrIDs

getStorageKeySQL :: MonadIO m
                 => SQL.Key AddressStateRef
                 -> HexStorage
                 -> String
                 -> SqlDbM m (SQL.Key Storage)
getStorageKeySQL addrID storageKey' s = do
  storageIDs <- SQL.selectKeysList
              [ StorageAddressStateRefId SQL.==. addrID, StorageKey SQL.==. storageKey' ]
              [ LimitTo 1 ]
  if null storageIDs
    then error $ s ++ ": Storage key not found in SQL db: " ++ show storageKey'
    else return $ head storageIDs
