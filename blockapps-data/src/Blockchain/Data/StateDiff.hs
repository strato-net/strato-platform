{-# LANGUAGE FlexibleInstances, DataKinds, TypeFamilies, NamedFieldPuns, ViewPatterns, DeriveGeneric, ExplicitForAll, StandaloneDeriving, OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.Data.StateDiff (
  StateDiff(..),
--  TXResult(..),
  AccountDiff(..),
  Diff(..),
  Detail(..),
  Detailed(..),
  stateDiff, 
  eventualAccountState, 
  incrementalAccountState
  ) where

import Blockchain.Database.MerklePatricia.Internal
import qualified Blockchain.Database.MerklePatricia.Diff as Diff
import Blockchain.Data.Address
import Blockchain.Data.AddressStateDB
import Blockchain.Data.RLP
import Blockchain.DB.AddressStateDB
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.StateDB
import Blockchain.ExtWord
import Blockchain.Format
import Blockchain.SHA

import Control.Monad.Trans.Resource

import Data.Aeson
import Data.Aeson.Types
import Data.Function
import Data.Maybe
import Data.String

import Data.ByteString (ByteString)

import Data.Map (Map)
import qualified Data.Map as Map

import qualified Data.NibbleString as N

import GHC.Generics

-- | Describes all the changes that have occurred in the blockchain
-- database in a given block.
data StateDiff = 
  StateDiff {               
    blockNumber :: Integer,
    blockHash :: SHA,
    -- | The 'Eventual value is the initial state of the contract
    createdAccounts :: Map Address (AccountDiff 'Eventual),
    -- | The 'Eventual value is the pre-deletion state of the contract
    deletedAccounts :: Map Address (AccountDiff 'Eventual),
    updatedAccounts :: Map Address (AccountDiff 'Incremental)
    }
    deriving (Generic)

instance (ToJSON a) => ToJSON (Map Address a) where
  toJSON = toJSON . Map.mapKeys formatAddressWithoutColor

instance (ToJSON a) => ToJSON (Map Word256 a) where
  toJSON = toJSON . Map.mapKeys format

instance (ToJSON a) => ToJSON (Map SHA a) where
  toJSON = toJSON . Map.mapKeys formatSHAWithoutColor

instance ToJSON StateDiff

{-
data TXResult =
  TXResult {
    message :: String,
    response :: String,
    etherUsed :: Word256,
    time :: Double
  }
  deriving (Generic)

instance ToJSON TXResult 
-}

-- | Describes all the changes to a particular account.  The address is not
-- recorded; it appears as the key in the map in the 'StateDiff'
data AccountDiff (v :: Detail) =
  AccountDiff {
    -- | The nonce may not change
    nonce :: Maybe (Diff Integer v),
    -- | The balance may not change
    balance :: Maybe (Diff Integer v),
    -- | Only present for newly created contracts, since the code can never
    -- change
    code :: Maybe (Diff ByteString v),
    -- | Since we want to always be able to identify account-type
    codeHash :: SHA, -- Maybe
    -- | This is necessary for when we commit an AddressStateRef to SQL.  
    -- It changes if and only if the storage changes at all
    contractRoot :: Maybe (Diff StateRoot v),
    -- | Only the storage keys that change are present in this map.
    storage :: Map Word256 (Diff Word256 v)
    }
    deriving (Generic)

-- | We have to duplicate the instance definitions because for some reason,
-- GHC doesn't infer that our instances for 'Diff a v' cover all values of
-- 'v'.
instance ToJSON (AccountDiff 'Incremental)
instance ToJSON (AccountDiff 'Eventual)

-- | Generic type for holding various kinds of diff
data family Diff a (v :: Detail)
-- | This instance records the exact relationship between the initial and
-- final states
data instance Diff a 'Incremental = 
  Create {newValue :: a} |
  Delete {oldValue :: a} |
  Update {oldValue :: a, newValue :: a}
-- | This instance just records the single meaningful value in the change.
-- See the 'Detailed' instance for what that means.
newtype instance Diff a 'Eventual = Value a

instance (ToJSON a) => ToJSON (Diff a 'Incremental) where
  toJSON Create{newValue} = object ["newValue" .= newValue]
  toJSON Delete{oldValue} = object ["oldValue" .= oldValue]
  toJSON Update{oldValue, newValue} =
    object [
      "newValue" .= newValue,
      "oldValue" .= oldValue
      ]

instance (ToJSON a) => ToJSON (Diff a 'Eventual) where
  toJSON (Value a) = toJSON a

-- | Not a type, but a data kind
data Detail = Incremental | Eventual

-- | A class for condensing information in a diff
class Detailed (t :: Detail -> *) where
  incrementalToEventual :: t 'Incremental -> t 'Eventual

instance Detailed AccountDiff where
  incrementalToEventual AccountDiff{nonce, balance, code, codeHash, contractRoot, storage} =
    AccountDiff{
      nonce = fmap incrementalToEventual nonce,
      balance = fmap incrementalToEventual balance,
      code = fmap incrementalToEventual code,
      codeHash = codeHash,
      contractRoot = fmap incrementalToEventual contractRoot,
      storage = Map.map incrementalToEventual storage
      }

instance {-# OVERLAPPABLE #-} (Num a) => Detailed (Diff a) where
  incrementalToEventual Delete{} = Value 0 -- ^ Ethereum-specific default value
  incrementalToEventual x = Value $ newValue x

instance Detailed (Diff StateRoot) where
  incrementalToEventual Delete{} = Value $ fromString ""
  incrementalToEventual x = Value $ newValue x

instance Detailed (Diff ByteString) where
  incrementalToEventual Delete{} = Value $ fromString ""
  incrementalToEventual x = Value $ newValue x

instance Detailed (Diff SHA) where
  incrementalToEventual Delete{} = Value $ hash ""
  incrementalToEventual x = Value $ newValue x

stateDiff :: (HasStateDB m, HasCodeDB m, HasHashDB m, MonadResource m) =>
             Integer -> SHA -> StateRoot -> StateRoot -> m StateDiff
stateDiff blockNumber blockHash oldRoot newRoot = do
  db <- getStateDB
  diffs <- Diff.dbDiff db oldRoot newRoot
  collectModes diffs $
    \createdAccounts deletedAccounts updatedAccounts -> 
      StateDiff{
        blockNumber,
        blockHash,
        createdAccounts,
        deletedAccounts,
        updatedAccounts
        }

  where
    collectModes diffs f = do
      (c, d, u) <- coll [] [] [] diffs
      return $ f c d u
    coll c d u [] = return (Map.fromList c, Map.fromList d, Map.fromList u)
    coll c d u (Diff.Create k v : rest) = do
      createDiff <- accountEnd k v
      coll (createDiff : c) d u rest
    coll c d u (Diff.Delete k v : rest) = do
      deleteDiff <- accountEnd k v
      coll c (deleteDiff : d) u rest
    coll c d u (Diff.Update k v1 v2 : rest) = do
      updateDiff <- accountUpdate k v1 v2
      coll c d (updateDiff : u) rest

accountEnd :: (HasHashDB m, HasCodeDB m, HasStateDB m, MonadResource m) => 
              [N.Nibble] -> Val -> m (Address, AccountDiff 'Eventual)
accountEnd k v = do
  address <- lookupAddress k
  let addrState = retrieveMPDBValue v
  accountDiff <- eventualAccountState addrState
  return (address, accountDiff)

accountUpdate :: (HasHashDB m, HasCodeDB m, HasStateDB m, MonadResource m) =>
                 [N.Nibble] -> Val -> Val -> m (Address, AccountDiff 'Incremental)
accountUpdate k vOld vNew = do
  address <- lookupAddress k
  let oldAddrState = retrieveMPDBValue vOld
      newAddrState = retrieveMPDBValue vNew
  accountDiff <- incrementalAccountState oldAddrState newAddrState
  return (address, accountDiff)

eventualAccountState :: (HasHashDB m, HasCodeDB m, HasStateDB m, MonadResource m) => 
                        AddressState -> m (AccountDiff 'Eventual)
eventualAccountState 
  AddressState{
    addressStateNonce,
    addressStateBalance,
    addressStateContractRoot,
    addressStateCodeHash
    }
  = do
    code <- lookupCode addressStateCodeHash
    storage <- eventualStorage addressStateContractRoot 
    return AccountDiff{
      nonce = Just $ Value addressStateNonce,
      balance = Just $ Value addressStateBalance,
      contractRoot = Just $ Value addressStateContractRoot,
      code = Just $ Value code,
      codeHash = addressStateCodeHash,
      storage
      }

incrementalAccountState :: (HasHashDB m, HasStateDB m, HasCodeDB m, MonadResource m) =>
                           AddressState -> AddressState -> m (AccountDiff 'Incremental)
incrementalAccountState oldState newState = do
  storage <- (incrementalStorage `on` addressStateContractRoot) oldState newState
  return AccountDiff{
    nonce = (diff `on` addressStateNonce) oldState newState,
    balance = (diff `on` addressStateBalance) oldState newState,
    contractRoot = (diff `on` addressStateContractRoot) oldState newState,
    code = Nothing,
    codeHash = addressStateCodeHash newState, 
    storage
    }

  where
    diff :: (Eq a) => a -> a -> Maybe (Diff a 'Incremental)
    diff x y = if x == y then Nothing else Just $ Update{oldValue = x, newValue = y}
    diff' x y = Update{oldValue = x, newValue = y}

eventualStorage :: (HasHashDB m, HasCodeDB m, HasStateDB m, MonadResource m) =>
                   StateRoot -> m (Map Word256 (Diff Word256 'Eventual))
eventualStorage storageRoot = do
  db <- getStateDB
  let storageDB = db{stateRoot = storageRoot}
  allStorageKV <- unsafeGetAllKeyVals storageDB
  storageAssoc <- mapM (uncurry decodeStorageKV) allStorageKV
  return $ Map.map Value $ Map.fromList storageAssoc

incrementalStorage :: (HasHashDB m, HasStateDB m, HasCodeDB m, MonadResource m) =>
                      StateRoot -> StateRoot -> m (Map Word256 (Diff Word256 'Incremental))
incrementalStorage oldRoot newRoot = do
  db <- getStateDB
  storageDiffs <- Diff.dbDiff db oldRoot newRoot
  storageAssoc <- mapM decodeDiffKV storageDiffs
  return $ Map.fromList storageAssoc

  where
    decodeDiffKV (Diff.Create k vNew) = do
      (key, newValue) <- decodeStorageKV (N.pack k) vNew
      return (key, Create{newValue})
    decodeDiffKV (Diff.Delete k vOld) = do
      (key, oldValue) <- decodeStorageKV (N.pack k) vOld
      return (key, Delete{oldValue})
    decodeDiffKV (Diff.Update k vOld vNew) = do
      key <- lookupStorageKey $ N.pack k
      let 
        oldValue = retrieveMPDBValue vOld
        newValue = retrieveMPDBValue vNew
      return (key, Update{oldValue, newValue})  

decodeStorageKV :: (HasHashDB m, HasCodeDB m) => Key -> Val -> m (Word256, Word256)
decodeStorageKV k v = do
  key <- lookupStorageKey k
  let val = retrieveMPDBValue v
  return (key, val)

retrieveMPDBValue :: (RLPSerializable a) => Val -> a
retrieveMPDBValue = rlpDecode . rlpDeserialize . rlpDecode

lookupAddress :: (HasCodeDB m, HasHashDB m, MonadResource m) => [N.Nibble] -> m Address
lookupAddress (N.pack -> addrHash) = lookupInMPDB "address" getAddressFromHash addrHash

lookupCode :: (HasHashDB m, HasCodeDB m, MonadResource m) => SHA -> m ByteString
lookupCode = lookupInMPDB "contract code" getCode 

lookupStorageKey :: (HasCodeDB m, HasHashDB m, MonadResource m) => Key -> m Word256
lookupStorageKey = lookupInMPDB "storage key" getStorageKeyFromHash

lookupInMPDB :: (HasHashDB m, HasCodeDB m, Format a) =>
                String -> (a -> m (Maybe b)) -> a -> m b
lookupInMPDB name f k = do
  v <- f k
  return $ flip fromMaybe v $
    error $ "MPDB key does not reference any known " ++ name ++ ": " ++ format k

