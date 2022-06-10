{-# LANGUAGE DataKinds        #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE NamedFieldPuns   #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies     #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Strato.StateDiff.Database
    ( commitSqlDiffs
    ) where

import           Database.Persist                            hiding (Update, get)
import qualified Database.Persist.Postgresql                 as SQL hiding (Update, get)

import           Blockchain.Data.DataDefs
import           Blockchain.Database.MerklePatricia.StateRoot (emptyTriePtr)
import           Blockchain.DB.CodeDB
import           Blockchain.DB.SQLDB
import           Blockchain.ExtWord
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.SolidVM.Model

import           Control.Lens ((^.))
import           Control.Monad
import           Control.Monad.IO.Class
import qualified Data.ByteString                             as BS
import           Data.Foldable                               (for_)
import qualified Data.Map                                    as Map
import           Data.Maybe

import           Blockchain.Strato.StateDiff

type SqlDbM m = SQL.SqlPersistT m

commitSqlDiffs :: HasSQLDB m => StateDiff -> m ()
commitSqlDiffs StateDiff{blockNumber, createdAccounts, deletedAccounts, updatedAccounts} = do
  sqlQuery $ do
    createAccount blockNumber $ Map.toList createdAccounts
    sequence_ $ Map.mapWithKey (const . deleteAccount) deletedAccounts
    sequence_ $ Map.mapWithKey (updateAccount blockNumber) updatedAccounts

codePtrHash :: CodePtr -> Maybe Keccak256
codePtrHash (EVMCode k) = Just k
codePtrHash (SolidVMCode _ k) = Just k
codePtrHash _ = Nothing

codePtrName :: CodePtr -> Maybe String
codePtrName (SolidVMCode n _) = Just n
codePtrName (CodeAtAccount _ n) = Just n
codePtrName _ = Nothing

codePtrAddress :: CodePtr -> Maybe Address
codePtrAddress (CodeAtAccount a _) = Just $ a ^. accountAddress
codePtrAddress _ = Nothing

codePtrChainId :: CodePtr -> Maybe Word256
codePtrChainId (CodeAtAccount a _) = a ^. accountChainId
codePtrChainId _ = Nothing

createAccount :: MonadIO m =>
                 Integer -> [(Account, AccountDiff 'Eventual)] -> SQL.SqlPersistT m ()
createAccount blockNumber accountDiffs = do
  let newAccounts = map (uncurry addrRef) accountDiffs
  addrIDs <- SQL.insertMany newAccounts

  newStorage <-
    forM (zip accountDiffs addrIDs) $ \(accountDiff, addrID) -> do
      let (_, diff) = accountDiff
      case storage diff of
        EVMDiff m -> return [Storage addrID EVM (word256ToHexStorage k) (word256ToHexStorage v)
                            | (k, Value v) <- Map.toList m]
        SolidVMDiff m -> return [Storage addrID SolidVM (HexStorage k) (HexStorage v)
                                | (k, Value v) <- Map.toList m]
  SQL.insertMany_ $ concat newStorage

  where
    addrRef account diff = AddressStateRef{
      addressStateRefAddress = account ^. accountAddress,
      addressStateRefNonce = getField (theError account "nonce") $ nonce diff,
      addressStateRefBalance = getField (theError account "balance") $ balance diff,
      addressStateRefContractRoot = getField (theError account "contractRoot") $ contractRoot diff,
      addressStateRefCode = getField (theError account "code") $ code diff,
      addressStateRefCodeHash = codePtrHash $ codeHash diff,
      addressStateRefContractName = codePtrName $ codeHash diff,
      addressStateRefCodePtrAddress = codePtrAddress $ codeHash diff,
      addressStateRefCodePtrChainId = codePtrChainId $ codeHash diff,
      addressStateRefLatestBlockDataRefNumber = blockNumber,
      addressStateRefChainId = fromMaybe 0 $ account ^. accountChainId
      }
    theError :: Account -> String -> a
    theError account name = error $
      "Missing field '" ++ name ++
      "' in contract creation diff for account " ++ show account

getField :: a -> Maybe (Diff a 'Eventual) -> a
getField def field =
  case field of
    Just (Value x) -> x
    Nothing        -> def

deleteAccount :: MonadIO m => Account -> SQL.SqlPersistT m ()
deleteAccount account = do
  mAddrID <- getAddressStateSQL account
  for_ mAddrID $ \addrID -> do
    SQL.deleteWhere [ StorageAddressStateRefId SQL.==. addrID ]
    SQL.delete addrID

updateAccount :: MonadIO m =>
                 Integer -> Account -> AccountDiff 'Incremental -> SQL.SqlPersistT m ()
updateAccount blockNumber account diff = do
  mAddrID <- getAddressStateSQL account
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
       in createAccount blockNumber [(account, eDiff')]
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
commitStorage addrID key v =
  let key' = word256ToHexStorage key
   in case v of
        Create{newValue} ->
          SQL.insert_ $ Storage addrID EVM key' (word256ToHexStorage newValue)
        Delete{} -> do
          mStorageID <- getStorageKeySQL addrID key'
          for_ mStorageID SQL.delete
        Update{newValue} -> do
          let newValue' = word256ToHexStorage newValue
          mStorageID <- getStorageKeySQL addrID key'
          case mStorageID of
            Nothing -> SQL.insert_ $ Storage addrID EVM key' newValue'
            Just storageID -> SQL.update storageID [ StorageValue =. newValue' ]

commitSolidStorage :: MonadIO m =>
                      SQL.Key AddressStateRef -> BS.ByteString -> Diff BS.ByteString 'Incremental -> SqlDbM m ()
commitSolidStorage addrID key v =
  let key' = HexStorage key
   in case v of
        Create{newValue} ->
          SQL.insert_ $ Storage addrID SolidVM key' (HexStorage newValue)
        Delete{} -> do
          mStorageID <- getStorageKeySQL addrID key'
          for_ mStorageID SQL.delete
        Update{newValue} -> do
          let newValue' = HexStorage newValue
          mStorageID <- getStorageKeySQL addrID key'
          case mStorageID of
            Nothing -> SQL.insert_ $ Storage addrID SolidVM key' newValue'
            Just storageID -> SQL.update storageID [ StorageValue =. newValue' ]

getAddressStateSQL :: MonadIO m
                   => Account
                   -> SqlDbM m (Maybe (SQL.Key AddressStateRef))
getAddressStateSQL (Account addr' chainId) = do
  addrIDs <- SQL.selectKeysList
              [ AddressStateRefAddress SQL.==. addr' , AddressStateRefChainId SQL.==. fromMaybe 0 chainId ] [ LimitTo 1 ]
  return $ listToMaybe addrIDs

getStorageKeySQL :: MonadIO m
                 => SQL.Key AddressStateRef
                 -> HexStorage
                 -> SqlDbM m (Maybe (SQL.Key Storage))
getStorageKeySQL addrID storageKey' = do
  storageIDs <- SQL.selectKeysList
              [ StorageAddressStateRefId SQL.==. addrID, StorageKey SQL.==. storageKey' ]
              [ LimitTo 1 ]
  return $ listToMaybe storageIDs
