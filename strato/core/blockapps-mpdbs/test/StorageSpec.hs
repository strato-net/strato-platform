{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}

module StorageSpec (storageSpec) where

import BlockApps.Logging
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SolidStorageDB
import Blockchain.DB.StorageDB
import Blockchain.Data.AddressStateDB
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Control.Lens
import Control.Monad
import Control.Monad.Change.Alter
import Control.Monad.IO.Class (liftIO)
import Control.Monad.Trans.Resource
import Control.Monad.Trans.State
import qualified Data.HashMap.Strict as HM
import qualified Data.Map as M
import qualified Data.NibbleString as N
import qualified Database.LevelDB as DB
import qualified Database.LevelDB.Base as DBB
import GHC.Generics
import qualified SolidVM.Model.Storable as MS
import System.Directory
import System.Posix.Temp
import Test.Hspec (Spec, describe, it)
import Test.Hspec.Expectations.Lifted
import UnliftIO.Exception
import Prelude hiding (abs, lookup)

type SMap = M.Map RawStorageKey RawStorageValue

type AMap = M.Map Address AddressStateModification

data CachedStorage = CS
  { _sdb :: DB.DB,
    _hdb :: HashDB,
    _stx :: SMap,
    _sbs :: SMap,
    _atx :: AMap,
    _abs :: AMap,
    _srm :: M.Map (Maybe Word256) MP.StateRoot
  }
  deriving (Generic)

makeLenses ''CachedStorage

type StorM = StateT CachedStorage (ResourceT (LoggingT IO))

instance HasMemRawStorageDB StorM where
  getMemRawStorageTxDB = use stx
  putMemRawStorageTxMap = assign stx
  getMemRawStorageBlockDB = use sbs
  putMemRawStorageBlockMap = assign sbs

instance HasMemAddressStateDB StorM where
  getAddressStateTxDBMap = use atx
  putAddressStateTxDBMap = assign atx
  getAddressStateBlockDBMap = use abs
  putAddressStateBlockDBMap = assign abs

instance (Address `Alters` AddressState) StorM where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance Selectable Address AddressState StorM where
  select _ = getAddressStateMaybe

instance (MP.StateRoot `Alters` MP.NodeData) StorM where
  lookup _ = MP.genericLookupDB $ use sdb
  insert _ = MP.genericInsertDB $ use sdb
  delete _ = MP.genericDeleteDB $ use sdb

instance (N.NibbleString `Alters` N.NibbleString) StorM where
  lookup _ = genericLookupHashDB $ use hdb
  insert _ = genericInsertHashDB $ use hdb
  delete _ = genericDeleteHashDB $ use hdb

instance (RawStorageKey `Alters` RawStorageValue) StorM where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance (Maybe Word256 `Alters` MP.StateRoot) StorM where
  lookup _ k = use $ srm . at k
  insert _ k v = srm . at k ?= v
  delete _ k = srm . at k .= Nothing

initialEnv :: IO (FilePath, CachedStorage)
initialEnv = do
  tmpdir <- mkdtemp "/tmp/storage_spec"
  let ldbOptions = DB.defaultOptions {DB.createIfMissing = True}
      openDB b = DBB.open (tmpdir ++ b) ldbOptions
  s <- openDB "/state/"
  h <- HashDB <$> openDB "/hash/"
  let st = CS s h M.empty M.empty M.empty M.empty M.empty
  fmap (tmpdir,) . runLoggingTWithLevel LevelError . runResourceT $ execStateT MP.initializeBlank st

runStorM :: StorM a -> IO a
runStorM mv =
  bracket
    initialEnv
    (removePathForcibly . fst)
    (runLoggingTWithLevel LevelError . runResourceT . evalStateT mv . snd)

getStorageKeyVal'' :: HasStorageDB m => Address -> Word256 -> m Word256
getStorageKeyVal'' addr key = do
  value <- getRawStorageKeyVal' (addr, MS.singleton $ word256ToBytes key)
  pure $ case value of
    MS.BInteger integer -> fromInteger integer
    MS.BDefault -> 0
    unexpected -> error $ "legacy integer storage contained " ++ show unexpected

putStorageKeyVal'' :: HasStorageDB m => Address -> Word256 -> Word256 -> m ()
putStorageKeyVal'' addr key value =
  putRawStorageKeyVal'
    (addr, MS.singleton $ word256ToBytes key)
    (if value == 0 then MS.BDefault else MS.BInteger $ toInteger value)

storageSpec :: Spec
storageSpec = do
  describe "StorageDB" $ do
    it "gets its puts" . runStorM $ do
      getStorageKeyVal'' 0x776 0x999 `shouldReturn` 0x0
      putStorageKeyVal'' 0x776 0x999 0x1234567890ab
      getStorageKeyVal'' 0x776 0x999 `shouldReturn` 0x1234567890ab

    it "gets its puts after a partial flush" . runStorM $ do
      putStorageKeyVal'' 0x1 0x2 0x3
      flushMemStorageTxDBToBlockDB
      use stx `shouldReturn` M.empty
      getStorageKeyVal'' 0x1 0x2 `shouldReturn` 0x3
      putStorageKeyVal'' 0x1 0x2 0x77777
      getStorageKeyVal'' 0x1 0x2 `shouldReturn` 0x77777

    it "gets its puts after a full flush" . runStorM $ do
      putStorageKeyVal'' 0x1 0x2 0x3
      flushMemStorageTxDBToBlockDB
      flushMemStorageDB
      use stx `shouldReturn` M.empty
      use sbs `shouldReturn` M.empty
      getStorageKeyVal'' 0x1 0x2 `shouldReturn` 0x3

    it "getAll returns nothing before a flush" . runStorM $ do
      putStorageKeyVal'' 0x1 0x2 0x3
      putStorageKeyVal'' 0x1 0x3 0x4
      putStorageKeyVal'' 0x1 0x4 0x5
      putStorageKeyVal'' 0x1 0x3 0x6
      getAllRawStorageKeyVals' 0x1 `shouldReturn` []

    it "getAll puts after a flush" . runStorM $ do
      putStorageKeyVal'' 0x1 0x2 0x3
      putStorageKeyVal'' 0x1 0x3 0x4
      putStorageKeyVal'' 0x1 0x4 0x5
      putStorageKeyVal'' 0x1 0x3 0x6
      flushMemStorageTxDBToBlockDB
      flushMemStorageDB
      use stx `shouldReturn` M.empty
      use sbs `shouldReturn` M.empty
      let toKey = N.EvenNibbleString . keccak256ToByteString . hash . word256ToBytes
      rawKvs <- getAllRawStorageKeyVals' 0x1
      let kvs :: [(MP.Key, Word256)]
          kvs =
            [ (key, fromInteger value)
            | (key, MS.BInteger value) <- rawKvs
            ]
      kvs
        `shouldMatchList` [ (toKey 2, 3),
                            (toKey 3, 6),
                            (toKey 4, 5)
                          ]

    it "put 0 should not change the state root" . runStorM $ do
      want <- addressStateContractRoot <$> lookupWithDefault Proxy (Address 0x1234)
      want `shouldBe` "V\232\US\ETB\ESC\204U\166\255\131E\230\146\192\248n[H\224\ESC\153l\173\192\SOHb/\181\227c\180!"
      putStorageKeyVal'' 0x1234 0x3 0x0
      flushMemStorageTxDBToBlockDB
      flushMemStorageDB
      got <- addressStateContractRoot <$> lookupWithDefault Proxy (Address 0x1234)
      want `shouldBe` got

    it "put 1 should change the state root" . runStorM $ do
      want <- addressStateContractRoot <$> lookupWithDefault Proxy (Address 0x1234)
      putStorageKeyVal'' 0x1234 0x3 0x44
      flushMemStorageTxDBToBlockDB
      flushMemStorageDB
      got <- addressStateContractRoot <$> lookupWithDefault Proxy (Address 0x1234)
      want `shouldNotBe` got

  describe "RawStorageDB" $ do
    it "should get its puts" . runStorM $ do
      putRawStorageKeyVal' (0x888, "aKey") "aValue"
      getRawStorageKeyVal' (0x888, "aKey") `shouldReturn` "aValue"

  describe "SolidStorageDB SolidVM=3.0" $ do
    it "should get its puts" . runStorM $ do
      putSolidStorageKeyVal' 0x99 (MS.fromList [MS.Field "x", MS.Index "99"]) (MS.BString "txt")
      getSolidStorageKeyVal' 0x99 (MS.fromList [MS.Field "x", MS.Index "99"])
        `shouldReturn` MS.BString "txt"

    it "should be able to flush" . runStorM $ do
      putSolidStorageKeyVal' 0x342 (MS.singleton "x") (MS.BBool True)
      flushMemSolidStorageTxDBToBlockDB
      flushMemSolidStorageDB

    it "inherits unchanged cached values when a storage root advances" . runStorM $ do
      let owner = 0x515151
          firstPath = MS.singleton "cacheInheritanceFirst"
          secondPath = MS.singleton "cacheInheritanceSecond"
          firstValue = MS.BInteger 11
          secondValue = MS.BInteger 22
      putSolidStorageKeyVal' owner firstPath firstValue
      flushMemSolidStorageTxDBToBlockDB
      flushMemSolidStorageDB
      firstRoot <- addressStateContractRoot <$> lookupWithDefault Proxy owner
      firstCache <- liftIO $ snapshotRawStorageReadCache firstRoot
      HM.lookup firstPath firstCache `shouldBe` Just (Just firstValue)

      putSolidStorageKeyVal' owner secondPath secondValue
      flushMemSolidStorageTxDBToBlockDB
      flushMemSolidStorageDB
      secondRoot <- addressStateContractRoot <$> lookupWithDefault Proxy owner
      secondCache <- liftIO $ snapshotRawStorageReadCache secondRoot
      HM.lookup firstPath secondCache `shouldBe` Just (Just firstValue)
      HM.lookup secondPath secondCache `shouldBe` Just (Just secondValue)

    let solidIdTest msg bv = it ("put " <> msg <> " in SolidStorage should not change the state root") . runStorM $ do
          want <- addressStateContractRoot <$> lookupWithDefault Proxy (Address 0x1234)
          want `shouldBe` "V\232\US\ETB\ESC\204U\166\255\131E\230\146\192\248n[H\224\ESC\153l\173\192\SOHb/\181\227c\180!"
          putSolidStorageKeyVal' 0x1234 (MS.fromList [MS.Field "x", MS.Index "99"]) bv
          flushMemSolidStorageTxDBToBlockDB
          flushMemStorageDB
          got <- addressStateContractRoot <$> lookupWithDefault Proxy (Address 0x1234)
          want `shouldBe` got

    solidIdTest "0" (MS.BInteger 0)
    solidIdTest "empty string" (MS.BString "")
    solidIdTest "False" (MS.BBool False)
    solidIdTest "zero address" (MS.BAddress 0)
    solidIdTest "zero enum value" (MS.BEnumVal "myEnum" "myEnumKey" 0)
    solidIdTest "zero contract" (MS.BContract "MyContractName" 0)
    solidIdTest "BDefault" (MS.BDefault)

    it "put 1 in SolidStorage should change the state root" . runStorM $ do
      want <- addressStateContractRoot <$> lookupWithDefault Proxy (Address 0x1234)
      putSolidStorageKeyVal' 0x1234 (MS.fromList [MS.Field "x", MS.Index "99"]) (MS.BInteger 1)
      flushMemSolidStorageTxDBToBlockDB
      flushMemStorageDB
      got <- addressStateContractRoot <$> lookupWithDefault Proxy (Address 0x1234)
      want `shouldNotBe` got
