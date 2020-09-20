{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}
module StorageSpec (storageSpec) where

import Control.DeepSeq
import Control.Lens
import Control.Monad
import Control.Monad.Change.Alter
import Control.Monad.Trans.State
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import qualified Data.Map as M
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Database.LevelDB as DB
import qualified Database.LevelDB.Base as DBB
import GHC.Generics
import Prelude hiding (abs, lookup)
import System.Posix.Temp
import System.Directory
import Test.Hspec (Spec, describe, it)
import Test.Hspec.Expectations.Lifted
import UnliftIO.Exception

import Blockchain.Data.AddressStateDB
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SolidStorageDB
import Blockchain.DB.StorageDB
import Blockchain.ExtWord
import Blockchain.Output
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import qualified Data.NibbleString as N
import qualified SolidVM.Model.Storable as MS

type SMap = M.Map (Account, B.ByteString) B.ByteString
type AMap = M.Map Account AddressStateModification

data CachedStorage = CS
  { _sdb :: DB.DB
  , _hdb :: HashDB
  , _stx :: SMap
  , _sbs :: SMap
  , _atx :: AMap
  , _abs :: AMap
  , _srm :: M.Map (Maybe Word256) MP.StateRoot
  } deriving (Generic, NFData)
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

instance (Account `Alters` AddressState) StorM where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

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
  let ldbOptions = DB.defaultOptions { DB.createIfMissing = True }
      openDB b = DBB.open (tmpdir ++ b) ldbOptions
  s <- openDB "/state/"
  h <- HashDB <$> openDB "/hash/"
  let st = CS s h M.empty M.empty M.empty M.empty M.empty
  fmap (tmpdir,) . runLoggingTWithLevel LevelError . runResourceT $ execStateT MP.initializeBlank st

runStorM :: StorM a -> IO a
runStorM mv = bracket initialEnv
                       (removePathForcibly . fst)
                       (runLoggingTWithLevel LevelError . runResourceT . evalStateT mv . snd)

getStorageKeyVal'' :: HasStorageDB m => Address -> Word256 -> m Word256
getStorageKeyVal'' addr = getStorageKeyVal' (Account addr Nothing)

putStorageKeyVal'' :: HasStorageDB m => Address -> Word256 -> Word256 -> m ()
putStorageKeyVal'' addr key = putStorageKeyVal' (Account addr Nothing) key

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
      flushMemStorageDB
      use stx `shouldReturn` M.empty
      use sbs `shouldReturn` M.empty
      getStorageKeyVal'' 0x1 0x2 `shouldReturn` 0x3

    it "getAll returns nothing before a flush" . runStorM $ do
      putStorageKeyVal'' 0x1 0x2 0x3
      putStorageKeyVal'' 0x1 0x3 0x4
      putStorageKeyVal'' 0x1 0x4 0x5
      putStorageKeyVal'' 0x1 0x3 0x6
      getAllStorageKeyVals' (Account 0x1 Nothing) `shouldReturn` []

    it "getAll puts after a flush" . runStorM $ do
      putStorageKeyVal'' 0x1 0x2 0x3
      putStorageKeyVal'' 0x1 0x3 0x4
      putStorageKeyVal'' 0x1 0x4 0x5
      putStorageKeyVal'' 0x1 0x3 0x6
      flushMemStorageDB
      use stx `shouldReturn` M.empty
      use sbs `shouldReturn` M.empty
      let toKey = N.EvenNibbleString . keccak256ToByteString . hash . word256ToBytes
      kvs <- getAllStorageKeyVals' (Account 0x1 Nothing)
      kvs `shouldMatchList` [ (toKey 2, 3)
                            , (toKey 3, 6)
                            , (toKey 4, 5)
                            ]

    it "put 0 should not change the state root" . runStorM $ do
      want <- addressStateContractRoot <$> lookupWithDefault Proxy (Account 0x1234 Nothing)
      want `shouldBe` "V\232\US\ETB\ESC\204U\166\255\131E\230\146\192\248n[H\224\ESC\153l\173\192\SOHb/\181\227c\180!"
      putStorageKeyVal'' 0x1234 0x3 0x0
      flushMemStorageDB
      got <- addressStateContractRoot <$> lookupWithDefault Proxy (Account 0x1234 Nothing)
      want `shouldBe` got


    it "put 1 should change the state root" . runStorM $ do
      want <- addressStateContractRoot <$> lookupWithDefault Proxy (Account 0x1234 Nothing)
      putStorageKeyVal'' 0x1234 0x3 0x44
      flushMemStorageDB
      got <- addressStateContractRoot <$> lookupWithDefault Proxy (Account 0x1234 Nothing)
      want `shouldNotBe` got
      got `shouldBe` "E\RS\164\USe\177\214\249m\186\SI\248\136\\\215\137\172\231\135q\224;\178TWg\SUB\147n\134. "

  describe "RawStorageDB" $ do
    it "should get its puts" . runStorM $ do
      putRawStorageKeyVal' ((Account 0x888 Nothing), "aKey") "aValue"
      getRawStorageKeyVal' ((Account 0x888 Nothing), "aKey") `shouldReturn` "aValue"

  describe "SolidStorageDB" $ do
    it "should get its puts" . runStorM $ do
      putSolidStorageKeyVal' (Account 0x99 Nothing) (MS.fromList [MS.Field "x", MS.ArrayIndex 99]) (MS.BString "txt")
      getSolidStorageKeyVal' (Account 0x99 Nothing) (MS.fromList [MS.Field "x", MS.ArrayIndex 99])
          `shouldReturn` MS.BString "txt"

    it "should be able to flush" . runStorM $ do
      putSolidStorageKeyVal' (Account 0x342 Nothing) (MS.singleton "x") (MS.BBool True)
      flushMemSolidStorageDB
