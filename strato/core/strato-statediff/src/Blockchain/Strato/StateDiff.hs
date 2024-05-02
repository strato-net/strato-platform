{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Strato.StateDiff
  ( StateDiff (..),
    AccountDiff (..),
    StorageDiff (..),
    Diff (..),
    Detail (..),
    Detailed (..),
    chainDiff,
    stateDiff,
    stateDiff',
    eventualAccountState,
    incrementalAccountState,
  )
where

import BlockApps.Logging
import Blockchain.DB.AddressStateDB
import Blockchain.DB.ChainDB
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia.Diff as Diff
import Blockchain.Database.MerklePatricia.Internal
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Conduit
import Control.Applicative
import Control.Monad (unless, when)
import Control.Monad.Change (Alters, Modifiable, Selectable)
import qualified Control.Monad.Change as A
import Data.ByteString (ByteString)
import qualified Data.ByteString as B
import Data.Function
import Data.Kind (Type)
import Data.Map (Map)
import qualified Data.Map as Map
import Data.Maybe
import qualified Data.NibbleString as N
import Data.String
import Data.Text (Text)
import qualified Data.Text as T
import GHC.Generics
import Text.Format

-- | Describes all the changes that have occurred in the blockchain
-- database in a given block.
data StateDiff = StateDiff
  { chainId :: Maybe Word256,
    blockNumber :: Integer,
    blockHash :: Keccak256,
    stateRoot :: StateRoot,
    -- | The 'Eventual value is the initial state of the contract
    createdAccounts :: Map Account (AccountDiff 'Eventual),
    -- | The 'Eventual value is the pre-deletion state of the contract
    deletedAccounts :: Map Account (AccountDiff 'Eventual),
    updatedAccounts :: Map Account (AccountDiff 'Incremental)
  }
  deriving (Generic)

data StorageDiff (v :: Detail)
  = EVMDiff (Map Word256 (Diff Word256 v))
  | SolidVMDiff (Map B.ByteString (Diff B.ByteString v))

class (Ord a) => StorableKey a where
  lookupStorageKey :: (MonadLogger m, HasHashDB m, HasCodeDB m) => Key -> m a

class StorableValue b where
  decodeMPDBValue :: Val -> b

instance StorableKey Word256 where
  lookupStorageKey = fmap (fromMaybe 0) . lookupInMPDB "storage key" getStorageKeyFromHash

instance StorableValue Word256 where
  decodeMPDBValue = retrieveMPDBValue

instance StorableKey B.ByteString where
  lookupStorageKey = fmap (fromMaybe "") . lookupInMPDB "raw storage key" getRawStorageKeyFromHash

instance StorableValue B.ByteString where
  decodeMPDBValue = rlpDecode

-- | Describes all the changes to a particular account.  The address is not
-- recorded; it appears as the key in the map in the 'StateDiff'
data AccountDiff (v :: Detail) = AccountDiff
  { -- | The nonce may not change
    nonce :: Maybe (Diff Integer v),
    -- | The balance may not change
    balance :: Maybe (Diff Integer v),
    -- | Only present for newly created contracts, since the code can never
    -- change
    code :: Maybe (Diff ByteString v),
    -- | Since we want to always be able to identify account-type
    codeHash :: CodePtr, -- Maybe
    sourceCodeHash :: Maybe (Keccak256, Text),
    -- | This is necessary for when we commit an AddressStateRef to SQL.
    -- It changes if and only if the storage changes at all
    contractRoot :: Maybe (Diff StateRoot v),
    -- | Only the storage keys that change are present in this map.
    storage :: StorageDiff v
  }
  deriving (Generic)

-- | Generic type for holding various kinds of diff
data family Diff a (v :: Detail)

-- | This instance records the exact relationship between the initial and
-- final states
data instance Diff a 'Incremental
  = Create {newValue :: a}
  | Delete {oldValue :: a}
  | Update {oldValue :: a, newValue :: a}

-- | This instance just records the single meaningful value in the change.
-- See the 'Detailed' instance for what that means.
newtype instance Diff a 'Eventual = Value a

-- | Not a type, but a data kind
data Detail = Incremental | Eventual

-- | A class for condensing information in a diff
class Detailed (t :: Detail -> Type) where
  incrementalToEventual :: t 'Incremental -> t 'Eventual

instance Detailed AccountDiff where
  incrementalToEventual AccountDiff {nonce, balance, code, codeHash, sourceCodeHash, contractRoot, storage} =
    AccountDiff
      { nonce = fmap incrementalToEventual nonce,
        balance = fmap incrementalToEventual balance,
        code = fmap incrementalToEventual code,
        codeHash = codeHash,
        sourceCodeHash = sourceCodeHash,
        contractRoot = fmap incrementalToEventual contractRoot,
        storage = incrementalToEventual storage
      }

instance {-# OVERLAPPABLE #-} (Num a) => Detailed (Diff a) where
  incrementalToEventual Delete {} = Value 0 --  ^ Ethereum-specific default value
  incrementalToEventual x = Value $ newValue x

instance Detailed (Diff String) where
  incrementalToEventual Delete {} = Value ""
  incrementalToEventual x = Value $ newValue x

instance Detailed (Diff StateRoot) where
  incrementalToEventual Delete {} = Value $ fromString ""
  incrementalToEventual x = Value $ newValue x

instance Detailed (Diff ByteString) where
  incrementalToEventual Delete {} = Value $ fromString ""
  incrementalToEventual x = Value $ newValue x

instance Detailed (Diff Keccak256) where
  incrementalToEventual Delete {} = Value $ hash ""
  incrementalToEventual x = Value $ newValue x

instance Detailed StorageDiff where
  incrementalToEventual (EVMDiff m) = EVMDiff $ Map.map incrementalToEventual m
  incrementalToEventual (SolidVMDiff m) = SolidVMDiff $ Map.map incrementalToEventual m

chainDiff ::
  ( MonadLogger m,
    HasStateDB m,
    HasCodeDB m,
    HasHashDB m,
    Modifiable BlockHashRoot m,
    Modifiable GenesisRoot m,
    Modifiable BestBlockRoot m,
    Selectable Account AddressState m
  ) =>
  Maybe Word256 ->
  Integer ->
  Keccak256 ->
  ConduitT i StateDiff m ()
chainDiff chainId newBlockNum newBlockHash = do
  newSR <- lift $ fromMaybe emptyTriePtr <$> getChainStateRoot chainId newBlockHash
  ~(bHash, bNum) <- lift $ fromMaybe (unsafeCreateKeccak256FromWord256 0, 0) <$> getChainBestBlock chainId
  unless (newBlockNum < bNum) $ do
    mSR <- lift $ liftA2 (<|>) (getChainStateRoot chainId bHash) (getGenesisStateRoot chainId)
    let sr = fromMaybe emptyTriePtr mSR
    stateDiff chainId newBlockNum newBlockHash sr newSR

stateDiff ::
  ( MonadLogger m,
    HasCodeDB m,
    HasHashDB m,
    HasStateDB m,
    Modifiable BestBlockRoot m,
    Selectable Account AddressState m
  ) =>
  Maybe Word256 ->
  Integer ->
  Keccak256 ->
  StateRoot ->
  StateRoot ->
  ConduitT i StateDiff m ()
stateDiff chainId blockNumber blockHash oldRoot newRoot = do
  lift $ putChainBestBlock chainId blockHash blockNumber
  mOldSR <- lift $ A.lookup (A.Proxy @MP.StateRoot) chainId
  lift $ A.insert (A.Proxy @MP.StateRoot) chainId newRoot
  stateDiff' chainId blockNumber blockHash oldRoot newRoot
  lift $ A.alter_ (A.Proxy @MP.StateRoot) chainId $ pure . const mOldSR

stateDiff' ::
  ( MonadLogger m,
    HasCodeDB m,
    HasHashDB m,
    (MP.StateRoot `Alters` MP.NodeData) m,
    Selectable Account AddressState m
  ) =>
  Maybe Word256 ->
  Integer ->
  Keccak256 ->
  StateRoot ->
  StateRoot ->
  ConduitT i StateDiff m ()
stateDiff' chainId blockNumber blockHash oldRoot newRoot = do
  Diff.dbDiff oldRoot newRoot
    .| (await >>= go (0 :: Integer) [])
    .| awaitForever (\i -> collectModes i emitDiff)
  where
    go _ diffs Nothing = yield $ reverse diffs
    go 100 diffs d = yield (reverse diffs) >> go 0 [] d
    go n diffs (Just d) = await >>= go (n + 1) (d : diffs)
    collectModes diffs f = do
      (c, d, u) <- coll [] [] [] diffs
      f c d u
    coll c d u [] = return (Map.fromList c, Map.fromList d, Map.fromList u)
    coll c d u (Diff.Create k v : rest) = do
      createDiff <- lift $ accountEnd chainId k v
      coll (createDiff : c) d u rest
    coll c d u (Diff.Delete k v : rest) = do
      deleteDiff <- lift $ accountEnd chainId k v
      coll c (deleteDiff : d) u rest
    coll c d u (Diff.Update k v1 v2 : rest) = do
      updateDiff <- lift $ accountUpdate chainId k v1 v2
      coll c d (updateDiff : u) rest
    emitDiff createdAccounts deletedAccounts updatedAccounts =
      yield $
        StateDiff
          chainId
          blockNumber
          blockHash
          newRoot
          createdAccounts
          deletedAccounts
          updatedAccounts

accountEnd ::
  ( MonadLogger m,
    HasHashDB m,
    HasCodeDB m,
    (MP.StateRoot `Alters` MP.NodeData) m,
    Selectable Account AddressState m
  ) =>
  Maybe Word256 ->
  [N.Nibble] ->
  Val ->
  m (Account, AccountDiff 'Eventual)
accountEnd chainId k v = do
  address <- lookupAddress k
  let addrState = retrieveMPDBValue v
  $logDebugS "accountEnd" . T.pack $ "End account state: " ++ show addrState
  accountDiff <- eventualAccountState addrState
  return (Account address chainId, accountDiff)

accountUpdate ::
  ( MonadLogger m,
    HasHashDB m,
    HasCodeDB m,
    (MP.StateRoot `Alters` MP.NodeData) m,
    Selectable Account AddressState m
  ) =>
  Maybe Word256 ->
  [N.Nibble] ->
  Val ->
  Val ->
  m (Account, AccountDiff 'Incremental)
accountUpdate chainId k vOld vNew = do
  address <- lookupAddress k
  let oldAddrState = retrieveMPDBValue vOld
      newAddrState = retrieveMPDBValue vNew
  $logDebugS "accountUpdate" . T.pack $ "Old account state: " ++ show oldAddrState
  $logDebugS "accountUpdate" . T.pack $ "New account state: " ++ show newAddrState
  accountDiff <- incrementalAccountState oldAddrState newAddrState
  return (Account address chainId, accountDiff)

eventualAccountState ::
  ( MonadLogger m,
    HasHashDB m,
    HasCodeDB m,
    (MP.StateRoot `Alters` MP.NodeData) m,
    Selectable Account AddressState m
  ) =>
  AddressState ->
  m (AccountDiff 'Eventual)
eventualAccountState
  AddressState
    { addressStateNonce,
      addressStateBalance,
      addressStateContractRoot,
      addressStateCodeHash
    } =
    do
      (kind, code) <- lookupCode addressStateCodeHash
      storage <- eventualStorage kind addressStateContractRoot
      return
        AccountDiff
          { nonce = Just (Value addressStateNonce),
            balance = Just (Value addressStateBalance),
            contractRoot = Just (Value addressStateContractRoot),
            code = Just (Value code),
            codeHash = addressStateCodeHash,
            sourceCodeHash = Nothing,
            storage
          }

incrementalAccountState ::
  ( MonadLogger m,
    HasHashDB m,
    HasCodeDB m,
    (MP.StateRoot `Alters` MP.NodeData) m,
    Selectable Account AddressState m
  ) =>
  AddressState ->
  AddressState ->
  m (AccountDiff 'Incremental)
incrementalAccountState oldState newState = do
  codeKind <- unsafeCodePtrToCodeKind (addressStateCodeHash newState)
  storage <- (incrementalStorage codeKind `on` addressStateContractRoot) oldState newState
  return
    AccountDiff
      { nonce = (diff `on` addressStateNonce) oldState newState,
        balance = (diff `on` addressStateBalance) oldState newState,
        contractRoot = (diff `on` addressStateContractRoot) oldState newState,
        code = Nothing,
        codeHash = addressStateCodeHash newState,
        sourceCodeHash = Nothing,
        storage
      }
  where
    diff :: (Eq a) => a -> a -> Maybe (Diff a 'Incremental)
    diff x y = if x == y then Nothing else Just Update {oldValue = x, newValue = y}

eventualStorage ::
  ( MonadLogger m,
    HasHashDB m,
    HasCodeDB m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  CodeKind ->
  StateRoot ->
  m (StorageDiff 'Eventual)
eventualStorage kind storageRoot = do
  allStorageKV <- unsafeGetAllKeyVals storageRoot
  let decodeAll = fmap (Map.map Value . Map.fromList) . (mapM (uncurry $ decodeStorageKV))
  ( case kind of
      EVM -> fmap EVMDiff . decodeAll
      SolidVM -> fmap SolidVMDiff . decodeAll
    )
    allStorageKV

incrementalStorage ::
  ( MonadLogger m,
    HasHashDB m,
    HasCodeDB m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  CodeKind ->
  StateRoot ->
  StateRoot ->
  m (StorageDiff 'Incremental)
incrementalStorage kind oldRoot newRoot = do
  storageDiffs <- runConduit $ Diff.dbDiff oldRoot newRoot .| sinkList
  let decodeAll = fmap Map.fromList . mapM decodeDiffKV
  ( case kind of
      EVM -> fmap EVMDiff . decodeAll
      SolidVM -> fmap SolidVMDiff . decodeAll
    )
    storageDiffs
  where
    decodeDiffKV (Diff.Create k vNew) = do
      (key, newValue) <- decodeStorageKV (N.pack k) vNew
      return (key, Create {newValue})
    decodeDiffKV (Diff.Delete k vOld) = do
      (key, oldValue) <- decodeStorageKV (N.pack k) vOld
      return (key, Delete {oldValue})
    decodeDiffKV (Diff.Update k vOld vNew) = do
      key <- lookupStorageKey $ N.pack k
      let oldValue = decodeMPDBValue vOld
          newValue = decodeMPDBValue vNew
      $logDebugS "incrementalStorage" . T.pack $ "OLD decoded MPDB Value: " ++ show oldValue
      $logDebugS "incrementalStorage" . T.pack $ "NEW decoded MPDB Value: " ++ show newValue
      return (key, Update {oldValue, newValue})

retrieveMPDBValue :: RLPSerializable a => Val -> a
retrieveMPDBValue = rlpDecode . rlpDeserialize . rlpDecode

decodeStorageKV ::
  ( MonadLogger m,
    HasHashDB m,
    HasCodeDB m,
    StorableKey a,
    StorableValue b,
    Show b
  ) =>
  Key ->
  Val ->
  m (a, b)
decodeStorageKV k v = do
  key <- lookupStorageKey k
  let val = decodeMPDBValue v
  $logDebugS "decodeStorageKV" . T.pack $ "decoded storage key/value: " ++ show val
  return (key, val)

lookupAddress :: (MonadLogger m, HasHashDB m) => [N.Nibble] -> m Address
lookupAddress (N.pack -> addrHash) = fromMaybe (Address 0) <$> lookupInMPDB "address" getAddressFromHash addrHash

lookupCode :: (MonadLogger m, HasHashDB m, HasCodeDB m, Selectable Account AddressState m) => CodePtr -> m (CodeKind, ByteString)
lookupCode (ExternallyOwned ch) = fromMaybe (EVM, "") <$> lookupInMPDB "contract code" getCode ch
lookupCode (SolidVMCode _ ch) = fromMaybe (SolidVM, "") <$> lookupInMPDB "contract code" getCode ch
lookupCode cp@(CodeAtAccount _ _) = maybe (pure (SolidVM, "")) lookupCode =<< unsafeResolveCodePtr cp

lookupInMPDB ::
  (MonadLogger m, Format a) =>
  String ->
  (a -> m (Maybe b)) ->
  a ->
  m (Maybe b)
lookupInMPDB name f k = do
  v <- f k
  when (isNothing v) $
    $logErrorS "lookupInMPDB" . T.pack $ "MPDB key does not reference any known " ++ name ++ ": " ++ format k
  pure v
