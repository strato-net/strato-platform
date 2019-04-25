{-# OPTIONS_GHC -fno-warn-orphans   #-}
module Blockchain.Strato.StateDiff
    ( StateDiff(..)
    , AccountDiff(..)
    , StorageDiff(..)
    , Diff(..)
    , Detail(..)
    , Detailed(..)
    , chainDiff
    , stateDiff
    , eventualAccountState
    , incrementalAccountState
    ) where

import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia.Diff     as Diff
import           Blockchain.Database.MerklePatricia.Internal hiding (stateRoot)
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import           Blockchain.DB.AddressStateDB
import           Blockchain.DB.ChainDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.StateDB
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord

import           Control.Applicative
import qualified Data.ByteString                             as B
import           Data.Function
import           Data.Maybe
import           Data.String
import           Data.Text                                   (Text)
import           Data.Traversable                            (forM)

import           Data.ByteString                             (ByteString)

import           Data.Map                                    (Map)
import qualified Data.Map                                    as Map

import qualified Data.NibbleString                           as N

import           GHC.Generics

import           Text.Format

-- | Describes all the changes that have occurred in the blockchain
-- database in a given block.
data StateDiff =
  StateDiff {
    chainId         :: Maybe Word256,
    blockNumber     :: Integer,
    blockHash       :: SHA,
    stateRoot       :: StateRoot,
    -- | The 'Eventual value is the initial state of the contract
    createdAccounts :: Map Address (AccountDiff 'Eventual),
    -- | The 'Eventual value is the pre-deletion state of the contract
    deletedAccounts :: Map Address (AccountDiff 'Eventual),
    updatedAccounts :: Map Address (AccountDiff 'Incremental)
    }
    deriving (Generic)

data StorageDiff (v :: Detail) = EVMDiff (Map Word256 (Diff Word256 v))
                               | SolidVMDiff (Map B.ByteString (Diff B.ByteString v))

class (Ord a) => StorableKey a where
  lookupStorageKey :: (HasHashDB m, HasCodeDB m) => Key -> m a

class StorableValue b where
  decodeMPDBValue :: Val -> b

instance StorableKey Word256 where
  lookupStorageKey = lookupInMPDB "storage key" getStorageKeyFromHash

instance StorableValue Word256 where
  decodeMPDBValue = retrieveMPDBValue

instance StorableKey B.ByteString where
  lookupStorageKey = lookupInMPDB "raw storage key" getRawStorageKeyFromHash

instance StorableValue B.ByteString where
  decodeMPDBValue = rlpDecode

-- | Describes all the changes to a particular account.  The address is not
-- recorded; it appears as the key in the map in the 'StateDiff'
data AccountDiff (v :: Detail) =
  AccountDiff {
    -- | The nonce may not change
    nonce        :: Maybe (Diff Integer v),
    -- | The balance may not change
    balance      :: Maybe (Diff Integer v),
    -- | Only present for newly created contracts, since the code can never
    -- change
    code         :: Maybe (Diff ByteString v),
    -- | Since we want to always be able to identify account-type
    codeHash     :: CodePtr, -- Maybe
    sourceCodeHash     :: Maybe (SHA, Text),
    -- | This is necessary for when we commit an AddressStateRef to SQL.
    -- It changes if and only if the storage changes at all
    contractRoot :: Maybe (Diff StateRoot v),
    -- | Only the storage keys that change are present in this map.
    storage      :: StorageDiff v
    }
    deriving (Generic)


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

-- | Not a type, but a data kind
data Detail = Incremental | Eventual

-- | A class for condensing information in a diff
class Detailed (t :: Detail -> *) where
  incrementalToEventual :: t 'Incremental -> t 'Eventual

instance Detailed AccountDiff where
  incrementalToEventual AccountDiff{nonce, balance, code, codeHash, sourceCodeHash, contractRoot, storage} =
    AccountDiff{
      nonce = fmap incrementalToEventual nonce,
      balance = fmap incrementalToEventual balance,
      code = fmap incrementalToEventual code,
      codeHash = codeHash,
      sourceCodeHash = sourceCodeHash,
      contractRoot = fmap incrementalToEventual contractRoot,
      storage = incrementalToEventual storage
      }

instance {-# OVERLAPPABLE #-} (Num a) => Detailed (Diff a) where
  incrementalToEventual Delete{} = Value 0 -- ^ Ethereum-specific default value
  incrementalToEventual x        = Value $ newValue x

instance Detailed (Diff String) where
  incrementalToEventual Delete{} = Value ""
  incrementalToEventual x        = Value $ newValue x

instance Detailed (Diff StateRoot) where
  incrementalToEventual Delete{} = Value $ fromString ""
  incrementalToEventual x        = Value $ newValue x

instance Detailed (Diff ByteString) where
  incrementalToEventual Delete{} = Value $ fromString ""
  incrementalToEventual x        = Value $ newValue x

instance Detailed (Diff SHA) where
  incrementalToEventual Delete{} = Value $ hash ""
  incrementalToEventual x        = Value $ newValue x

instance Detailed StorageDiff where
  incrementalToEventual (EVMDiff m) = EVMDiff $ Map.map incrementalToEventual m
  incrementalToEventual (SolidVMDiff m) = SolidVMDiff $ Map.map incrementalToEventual m

chainDiff :: (HasStateDB m, HasChainDB m, HasCodeDB m, HasHashDB m)
          => Integer -> SHA -> [Word256] -> m [StateDiff]
chainDiff newBlockNum newBlockHash chains = fmap catMaybes . forM chains $ \chainId -> do
  newSR <- fromMaybe emptyTriePtr <$> getChainStateRoot chainId newBlockHash
  ~(bHash, bNum) <- fromMaybe (SHA 0, 0) <$> getChainBestBlock chainId
  if newBlockNum < bNum
    then return Nothing
    else do
      mSR <- liftA2 (<|>) (getChainStateRoot chainId bHash) (getGenesisStateRoot chainId)
      let sr = fromMaybe emptyTriePtr mSR
      putChainBestBlock chainId newBlockHash newBlockNum
      Just <$> stateDiff (Just chainId) newBlockNum newBlockHash sr newSR

stateDiff :: (HasStateDB m, HasCodeDB m, HasHashDB m) =>
             Maybe Word256 -> Integer -> SHA -> StateRoot -> StateRoot -> m StateDiff
stateDiff chainId blockNumber blockHash oldRoot newRoot = do
  db <- getStateDB
  diffs <- Diff.dbDiff db oldRoot newRoot
  collectModes diffs $
    \createdAccounts deletedAccounts updatedAccounts ->
      StateDiff
        chainId
        blockNumber
        blockHash
        newRoot
        createdAccounts
        deletedAccounts
        updatedAccounts

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

accountEnd :: (HasHashDB m, HasCodeDB m, HasStateDB m) =>
              [N.Nibble] -> Val -> m (Address, AccountDiff 'Eventual)
accountEnd k v = do
  address <- lookupAddress k
  let addrState = retrieveMPDBValue v
  accountDiff <- eventualAccountState addrState
  return (address, accountDiff)

accountUpdate :: (HasHashDB m, HasCodeDB m, HasStateDB m) =>
                 [N.Nibble] -> Val -> Val -> m (Address, AccountDiff 'Incremental)
accountUpdate k vOld vNew = do
  address <- lookupAddress k
  let oldAddrState = retrieveMPDBValue vOld
      newAddrState = retrieveMPDBValue vNew
  accountDiff <- incrementalAccountState oldAddrState newAddrState
  return (address, accountDiff)

eventualAccountState :: (HasHashDB m, HasCodeDB m, HasStateDB m) =>
                        AddressState -> m (AccountDiff 'Eventual)
eventualAccountState
  AddressState{
    addressStateNonce,
    addressStateBalance,
    addressStateContractRoot,
    addressStateCodeHash
    }
  = do
    (kind, code) <- lookupCode addressStateCodeHash
    storage <- eventualStorage kind addressStateContractRoot
    return AccountDiff{
      nonce = Just (Value addressStateNonce),
      balance = Just (Value addressStateBalance),
      contractRoot = Just (Value addressStateContractRoot),
      code = Just (Value code),
      codeHash = addressStateCodeHash,
      sourceCodeHash = Nothing,
      storage
      }


incrementalAccountState :: (HasHashDB m, HasStateDB m, HasCodeDB m) =>
                           AddressState -> AddressState -> m (AccountDiff 'Incremental)
incrementalAccountState oldState newState = do
  let codeKind = case addressStateCodeHash newState of
                   EVMCode{} -> EVM
                   SolidVMCode{} -> SolidVM
  storage <- (incrementalStorage codeKind `on` addressStateContractRoot) oldState newState
  return AccountDiff{
    nonce = (diff `on` addressStateNonce) oldState newState,
    balance = (diff `on` addressStateBalance) oldState newState,
    contractRoot = (diff `on` addressStateContractRoot) oldState newState,
    code = Nothing,
    codeHash = addressStateCodeHash newState,
    sourceCodeHash = Nothing,
    storage
    }

  where
    diff :: (Eq a) => a -> a -> Maybe (Diff a 'Incremental)
    diff x y = if x == y then Nothing else Just Update{oldValue = x, newValue = y}

eventualStorage :: (HasHashDB m, HasCodeDB m, HasStateDB m) =>
                   CodeKind -> StateRoot -> m (StorageDiff 'Eventual)
eventualStorage kind storageRoot = do
  db <- getStateDB
  let storageDB = db{MP.stateRoot = storageRoot}
  allStorageKV <- unsafeGetAllKeyVals storageDB
  let decodeAll :: (HasCodeDB m, HasHashDB m, StorableKey a, StorableValue b)
                => [(Key, Val)] -> m (Map a (Diff b 'Eventual))
      decodeAll = fmap (Map.map Value . Map.fromList) . (mapM (uncurry $ decodeStorageKV))
  (case kind of
      EVM -> fmap EVMDiff . decodeAll
      SolidVM -> fmap SolidVMDiff . decodeAll) allStorageKV

incrementalStorage :: (HasHashDB m, HasStateDB m, HasCodeDB m) =>
                      CodeKind -> StateRoot -> StateRoot -> m (StorageDiff 'Incremental)
incrementalStorage kind oldRoot newRoot = do
  db <- getStateDB
  storageDiffs <- Diff.dbDiff db oldRoot newRoot
  let decodeAll :: (HasCodeDB m, HasHashDB m, StorableKey a, StorableValue b)
                => [Diff.DiffOp] -> m (Map a (Diff b 'Incremental))
      decodeAll = fmap Map.fromList . mapM decodeDiffKV
  (case kind of
    EVM -> fmap EVMDiff . decodeAll
    SolidVM -> fmap SolidVMDiff . decodeAll) storageDiffs

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
        oldValue = decodeMPDBValue vOld
        newValue = decodeMPDBValue vNew
      return (key, Update{oldValue, newValue})

retrieveMPDBValue :: RLPSerializable a => Val -> a
retrieveMPDBValue = rlpDecode . rlpDeserialize . rlpDecode

decodeStorageKV :: (HasHashDB m, HasCodeDB m, StorableKey a, StorableValue b) => Key -> Val -> m (a, b)
decodeStorageKV k v = do
  key <- lookupStorageKey k
  let val = decodeMPDBValue v
  return (key, val)

lookupAddress :: (HasCodeDB m, HasHashDB m) => [N.Nibble] -> m Address
lookupAddress (N.pack -> addrHash) = lookupInMPDB "address" getAddressFromHash addrHash

lookupCode :: (HasHashDB m, HasCodeDB m) => CodePtr -> m (CodeKind, ByteString)
lookupCode (EVMCode ch) = lookupInMPDB "contract code" getCode ch
lookupCode (SolidVMCode _ ch) = lookupInMPDB "contract code" getCode ch

lookupInMPDB :: (HasHashDB m, HasCodeDB m, Format a) =>
                String -> (a -> m (Maybe b)) -> a -> m b
lookupInMPDB name f k = do
  v <- f k
  return $ flip fromMaybe v $
    error $ "MPDB key does not reference any known " ++ name ++ ": " ++ format k
