{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE NamedFieldPuns #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Strato.StateDiff.Database
  ( commitSqlDiffs,
    commitSqlDiffsSql,
    codePtrHash
  )
where

import BlockApps.Logging
import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Database.MerklePatricia.StateRoot (emptyTriePtr)
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.StateDiff
import Blockchain.Data.Transaction (codePtrHash, codePtrName)
import Control.Monad
import Control.Monad.IO.Class
import qualified Data.ByteString as BS
import Data.Foldable (for_, traverse_)
import qualified Data.Map as Map
import Data.Maybe
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8)
import Database.Persist hiding (Update, get)
import qualified Database.Persist.Postgresql as SQL hiding (Update, get)
import SolidVM.Model.Storable (StoragePath, BasicValue)
import UnliftIO

type SqlDbM m = SQL.SqlPersistT m

commitSqlDiffs :: (MonadLogger m, HasSQLDB m) => StateDiff -> m ()
commitSqlDiffs = sqlQuery . commitSqlDiffsSql

-- | One state diff's writes as a single 'SQL.SqlPersistT' action, so the
-- indexer can commit it in the same transaction as the block it belongs to.
-- Every write here is idempotent (upserts, or a lookup before insert), so a
-- diff replayed after a crash or a writer promotion leaves the tables as if
-- it had been applied once. This used to run without a transaction so that a
-- failing code insert could be logged and skipped; that case is now isolated
-- with a savepoint instead.
commitSqlDiffsSql :: (MonadUnliftIO m, MonadLogger m) => StateDiff -> SQL.SqlPersistT m ()
commitSqlDiffsSql StateDiff {blockNumber, createdAccounts, deletedAccounts, updatedAccounts} = do
  createAccount blockNumber $ Map.toList createdAccounts
  sequence_ $ Map.mapWithKey (const . deleteAccount) deletedAccounts
  sequence_ $ Map.mapWithKey (updateAccount blockNumber) updatedAccounts

createAccount ::
  (MonadUnliftIO m, MonadLogger m) =>
  Integer ->
  [(Address, AccountDiff 'Eventual)] ->
  SQL.SqlPersistT m ()
createAccount blockNumber accountDiffs =
  tryCreates
--  catch tryCreates $ \(e :: SomeException) -> $logErrorS "commitSqlDiffs/createAccount" . T.pack $ "Failed to create account: " ++ show e
  where
    tryCreates = do
      let newAccounts = map (uncurry addrRef) accountDiffs
      $logDebugS "commitSqlDiffs/createAccount" . T.pack $ "Creating accounts: " ++ (unlines $ map show newAccounts)
      addrIDs <- map SQL.entityKey <$> traverse (`SQL.upsert` []) newAccounts

      -- A freshly created account normally has no storage rows yet, so the
      -- lookup is one cheap query per account; on a replay it is what keeps
      -- the rows from being inserted twice.
      forM_ (zip accountDiffs addrIDs) $ \(accountDiff, addrID) -> do
        let (_, diff) = accountDiff
        case storage diff of
          EVMDiff _ -> return ()
          SolidVMDiff m -> do
            existing <- SQL.selectList [StorageAddressStateRefId SQL.==. addrID] []
            let present = Map.fromList [(storageKey st, (sid, storageValue st)) | SQL.Entity sid st <- existing]
                wanted = [(k, v) | (k, Value v) <- Map.toList m]
                fresh = [Storage addrID k v | (k, v) <- wanted, Map.notMember k present]
            $logDebugS "commitSqlDiffs/createAccount" . T.pack $ "Inserting storage: " ++ (unlines $ map show fresh)
            SQL.insertMany_ fresh
            forM_ wanted $ \(k, v) -> case Map.lookup k present of
              Just (sid, old) | old /= v -> SQL.update sid [StorageValue =. v]
              _ -> pure ()

      -- Isolate the code upserts so a failure is logged and skipped, as
      -- before, without aborting the enclosing transaction.
      SQL.rawExecute "SAVEPOINT code_ref" []
      ( do
          traverse_ (`SQL.upsert` []) (uncurry codeRef <$> accountDiffs)
          SQL.rawExecute "RELEASE SAVEPOINT code_ref" []
        )
        `catch` ( \(e :: SomeException) -> do
                    $logWarnS "commitSqlDiffs/createAccount" . T.pack $ "Error inserting code: " ++ show e
                    SQL.rawExecute "ROLLBACK TO SAVEPOINT code_ref" []
                )
    code' account diff = getField (theError account "code") $ code diff
    codeRef account diff =
      CodeRef
        { codeRefCodeHash = hash $ code' account diff,
          codeRefCode = decodeUtf8 $ code' account diff
        }
    addrRef account diff =
      AddressStateRef
        { addressStateRefAddress = account,
          addressStateRefNonce = getField (theError account "nonce") $ nonce diff,
          addressStateRefBalance = getField (theError account "balance") $ balance diff,
          addressStateRefContractRoot = getField (theError account "contractRoot") $ contractRoot diff,
          -- addressStateRefCode = getField (theError account "code") $ code diff,
          addressStateRefCodeHash = codePtrHash $ codeHash diff,
          addressStateRefContractName = codePtrName $ codeHash diff,
          addressStateRefLatestBlockDataRefNumber = blockNumber
        }
    theError :: Address -> String -> a
    theError account name =
      error $
        "Missing field '" ++ name
          ++ "' in contract creation diff for account "
          ++ show account

getField :: a -> Maybe (Diff a 'Eventual) -> a
getField def field =
  case field of
    Just (Value x) -> x
    Nothing -> def

deleteAccount :: MonadIO m => Address -> SQL.SqlPersistT m ()
deleteAccount account = do
  mAddrID <- getAddressStateSQL account
  for_ mAddrID $ \addrID -> do
    SQL.deleteWhere [StorageAddressStateRefId SQL.==. addrID]
    SQL.delete addrID

updateAccount ::
  (MonadUnliftIO m, MonadLogger m) =>
  Integer ->
  Address ->
  AccountDiff 'Incremental ->
  SQL.SqlPersistT m ()
updateAccount blockNumber account diff = do
  mAddrID <- getAddressStateSQL account
  case mAddrID of
    Nothing ->
      let eDiff = incrementalToEventual diff
          nonce' = Just . fromMaybe (Value 0) $ nonce eDiff
          balance' = Just . fromMaybe (Value 0) $ balance eDiff
          contractRoot' = Just . fromMaybe (Value emptyTriePtr) $ contractRoot eDiff
          code' = Just . fromMaybe (Value BS.empty) $ code eDiff
          eDiff' =
            eDiff
              { nonce = nonce',
                balance = balance',
                contractRoot = contractRoot',
                code = code'
              }
       in createAccount blockNumber [(account, eDiff')]
    Just addrID -> do
      SQL.update addrID $
        setField nonce AddressStateRefNonce $
          setField balance AddressStateRefBalance $
            [AddressStateRefLatestBlockDataRefNumber =. blockNumber]
      case storage diff of
        EVMDiff _ -> pure ()
        SolidVMDiff m2 -> sequence_ $ Map.mapWithKey (commitSolidStorage addrID) m2
  where
    setField field sqlField = maybe id (\v -> ((sqlField =. takeIncremental v) :)) $ field diff
    takeIncremental Create {newValue} = newValue
    takeIncremental Delete {} = 0
    takeIncremental Update {newValue} = newValue

commitSolidStorage ::
  MonadIO m =>
  SQL.Key AddressStateRef ->
  StoragePath ->
  Diff BasicValue 'Incremental ->
  SqlDbM m ()
commitSolidStorage addrID key v =
  case v of
    -- A Create is written like an Update: the key may already be present if
    -- this diff is being replayed, and a second row for the same key would
    -- make the storage API return duplicates.
    Create {newValue} -> upsertStorage newValue
    Delete {} -> do
      mStorageID <- getStorageKeySQL addrID key
      for_ mStorageID SQL.delete
    Update {newValue} -> upsertStorage newValue
  where
    upsertStorage newValue = do
      mStorageID <- getStorageKeySQL addrID key
      case mStorageID of
        Nothing -> SQL.insert_ $ Storage addrID key newValue
        Just storageID -> SQL.update storageID [StorageValue =. newValue]

getAddressStateSQL ::
  MonadIO m =>
  Address ->
  SqlDbM m (Maybe (SQL.Key AddressStateRef))
getAddressStateSQL addr' = do
  addrIDs <-
    SQL.selectKeysList
      [AddressStateRefAddress SQL.==. addr']
      [LimitTo 1]
  return $ listToMaybe addrIDs

getStorageKeySQL ::
  MonadIO m =>
  SQL.Key AddressStateRef ->
  StoragePath ->
  SqlDbM m (Maybe (SQL.Key Storage))
getStorageKeySQL addrID storageKey' = do
  storageIDs <-
    SQL.selectKeysList
      [StorageAddressStateRefId SQL.==. addrID, StorageKey SQL.==. storageKey']
      [LimitTo 1]
  return $ listToMaybe storageIDs
