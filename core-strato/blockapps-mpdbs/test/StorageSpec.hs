{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE TypeApplications #-}
module StorageSpec (storageSpec) where

import Control.Lens
import Control.Monad
import Control.Monad.Change.Alter
import Control.Monad.Trans.State
import Control.Monad.Trans.Resource
import Data.Either
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

import Blockchain.Data.ChainInfo
import Blockchain.Data.AddressStateDB
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SolidStorageDB
import Blockchain.DB.X509CertDB
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
  , _x50 :: M.Map Address X509Certificate
  , _parentChainMap :: M.Map (Maybe Word256) ParentChainId
  } deriving (Generic)
makeLenses ''CachedStorage

type StorM = StateT CachedStorage (ResourceT (LoggingT IO))

instance (Maybe Word256 `Alters` ParentChainId) StorM where
  lookup _ k    = use $ parentChainMap . at k
  insert _ k v  = parentChainMap . at k ?= v
  delete _ k    = parentChainMap . at k .= Nothing

instance Selectable (Maybe Word256) ParentChainId StorM where
  select = lookup

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

instance (Address `Alters` X509Certificate) StorM where
  lookup _ k   = use $ x50 . at k
  insert _ k v = x50 . at k ?= v
  delete _ k   = x50 . at k .= Nothing

initialEnv :: IO (FilePath, CachedStorage)
initialEnv = do
  tmpdir <- mkdtemp "/tmp/storage_spec"
  let ldbOptions = DB.defaultOptions { DB.createIfMissing = True }
      openDB b = DBB.open (tmpdir ++ b) ldbOptions
  s <- openDB "/state/"
  h <- HashDB <$> openDB "/hash/"
  let st = CS s h M.empty M.empty M.empty M.empty M.empty M.empty M.empty
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

  describe "SolidStorageDB SolidVM=3.0" $ do
    it "should get its puts" . runStorM $ do
      putSolidStorageKeyVal' True (Account 0x99 Nothing) (MS.fromList [MS.Field "x", MS.ArrayIndex 99]) (MS.BString "txt")
      getSolidStorageKeyVal' (Account 0x99 Nothing) (MS.fromList [MS.Field "x", MS.ArrayIndex 99])
          `shouldReturn` MS.BString "txt"

    it "should be able to flush" . runStorM $ do
      putSolidStorageKeyVal' True (Account 0x342 Nothing) (MS.singleton "x") (MS.BBool True)
      flushMemSolidStorageDB

    let solidIdTest msg bv = it ("put " <> msg <> " in SolidStorage should not change the state root") . runStorM $ do
          want <- addressStateContractRoot <$> lookupWithDefault Proxy (Account 0x1234 Nothing)
          want `shouldBe` "V\232\US\ETB\ESC\204U\166\255\131E\230\146\192\248n[H\224\ESC\153l\173\192\SOHb/\181\227c\180!"
          putSolidStorageKeyVal' True (Account 0x1234 Nothing) (MS.fromList [MS.Field "x", MS.ArrayIndex 99]) bv
          flushMemStorageDB
          got <- addressStateContractRoot <$> lookupWithDefault Proxy (Account 0x1234 Nothing)
          want `shouldBe` got
    
    solidIdTest "0"               (MS.BInteger 0)
    solidIdTest "empty string"    (MS.BString "")
    solidIdTest "False"           (MS.BBool False)
    solidIdTest "zero account"    (MS.BAccount $ unspecifiedChain 0)
    solidIdTest "zero enum value" (MS.BEnumVal "myEnum" "myEnumKey" 0)
    solidIdTest "zero contract"   (MS.BContract "MyContractName" $ unspecifiedChain 0)
    solidIdTest "BDefault"        (MS.BDefault)

    it "put 1 in SolidStorage should change the state root" . runStorM $ do
      want <- addressStateContractRoot <$> lookupWithDefault Proxy (Account 0x1234 Nothing)
      putSolidStorageKeyVal' True (Account 0x1234 Nothing) (MS.fromList [MS.Field "x", MS.ArrayIndex 99]) (MS.BInteger 1)
      flushMemStorageDB
      got <- addressStateContractRoot <$> lookupWithDefault Proxy (Account 0x1234 Nothing)
      want `shouldNotBe` got
      got `shouldBe` "\223\231^\"\234'\233\249\208*D\163\210\237\147\ETXq\202\EM\208\195\140\223\&7J\SI\201\250\&9\165\177\141"

  describe "X509 Certificates" $ do
    it "should get its puts" . runStorM $ do
      let address = 0x888 :: Address
          x509Cert = fromRight (error "failed to parse cert") $ bsToCert "-----BEGIN CERTIFICATE-----\nMIIBiDCCAS2gAwIBAgIQCgO76hC29iXEFXJNco5ekjAMBggqhkjOPQQDAgUAMEYx\nDDAKBgNVBAMMA2RhbjEMMAoGA1UEBgwDVVNBMRIwEAYDVQQKDAlibG9ja2FwcHMx\nFDASBgNVBAsMC2VuZ2luZWVyaW5nMB4XDTIxMDMxODE1NDgwN1oXDTIyMDMxODE1\nNDgwN1owRjEMMAoGA1UEAwwDZGFuMQwwCgYDVQQGDANVU0ExEjAQBgNVBAoMCWJs\nb2NrYXBwczEUMBIGA1UECwwLZW5naW5lZXJpbmcwVjAQBgcqhkjOPQIBBgUrgQQA\nCgNCAAQY4p67l1IIEUdVC7L+rUDwF5Nv30bze0NV5y8ced7qwp+YFk3UAiOGkcYo\n7ba8F92rd0yf9AGpvZN1H3Dda8xdMAwGCCqGSM49BAMCBQADRwAwRAIgbKXO8tZ5\noPhBusPQFkNEQDnLO/MRru4KjtCpPnVb5sACIE0TwBJ7yeIGuPc/8G50/858Pf3a\n0t1hHbhYnJarPkNA\n-----END CERTIFICATE-----"
      insert Proxy address x509Cert
      value <- lookup Proxy address
      value `shouldBe` Just x509Cert
    it "replace a puts" . runStorM $ do
      let address = 0x888 :: Address
          x509Cert = fromRight (error "failed to parse cert") $ bsToCert "-----BEGIN CERTIFICATE-----\nMIIBiDCCAS2gAwIBAgIQCgO76hC29iXEFXJNco5ekjAMBggqhkjOPQQDAgUAMEYx\nDDAKBgNVBAMMA2RhbjEMMAoGA1UEBgwDVVNBMRIwEAYDVQQKDAlibG9ja2FwcHMx\nFDASBgNVBAsMC2VuZ2luZWVyaW5nMB4XDTIxMDMxODE1NDgwN1oXDTIyMDMxODE1\nNDgwN1owRjEMMAoGA1UEAwwDZGFuMQwwCgYDVQQGDANVU0ExEjAQBgNVBAoMCWJs\nb2NrYXBwczEUMBIGA1UECwwLZW5naW5lZXJpbmcwVjAQBgcqhkjOPQIBBgUrgQQA\nCgNCAAQY4p67l1IIEUdVC7L+rUDwF5Nv30bze0NV5y8ced7qwp+YFk3UAiOGkcYo\n7ba8F92rd0yf9AGpvZN1H3Dda8xdMAwGCCqGSM49BAMCBQADRwAwRAIgbKXO8tZ5\noPhBusPQFkNEQDnLO/MRru4KjtCpPnVb5sACIE0TwBJ7yeIGuPc/8G50/858Pf3a\n0t1hHbhYnJarPkNA\n-----END CERTIFICATE-----"
          x509Cert' = fromRight (error "failed to parse cert") $ bsToCert "-----BEGIN CERTIFICATE-----\nMIIBdjCCARugAwIBAgIQL0qWnhe3DPTMIaL5AiYxOTAMBggqhkjOPQQDAgUAMD0x\nDTALBgNVBAMMBGx1a2UxDDAKBgNVBAYMA1VTQTEOMAwGA1UECgwFYmF5ZXIxDjAM\nBgNVBAsMBXNhbGVzMB4XDTIxMDQwMjE3NDMzMloXDTIyMDQwMjE3NDMzMlowPTEN\nMAsGA1UEAwwEbHVrZTEMMAoGA1UEBgwDVVNBMQ4wDAYDVQQKDAViYXllcjEOMAwG\nA1UECwwFc2FsZXMwVjAQBgcqhkjOPQIBBgUrgQQACgNCAATs37kyFit5b5P4dS1D\nJr04iHsN9fy7Rw4Os+3TpYcTd4OqZa1OoInwEUirQPXmDmt/77uY+0TybMhdnRtL\n+6dsMAwGCCqGSM49BAMCBQADRwAwRAIgdsXIAZNAL64Cha00S5tAsz2DxmQhPd4W\n2PWbBqwTbOcCICId88YjO0rOa/sYyOoYj2P2RaZFXESa4zqadO1MYcBo\n-----END CERTIFICATE-----";
      insert Proxy address x509Cert
      insert Proxy address x509Cert'
      value <- lookup Proxy address
      value `shouldNotBe` Just x509Cert

  describe "resolveCodePtr" $ do
    it "should resolve direct code pointers" . runStorM $ do
      let chainRelationships = [(Just (0 :: Word256), ParentChainId $ Nothing)]
      insertMany (Proxy @ParentChainId) $ M.fromList chainRelationships
      let accts = [Account 0xabc (Just 0)
                  , Account 0xdef (Just 0)]
      let codePtrs = [SolidVMCode "Code_0" $ unsafeCreateKeccak256FromWord256 0x123
                      , EVMCode $ unsafeCreateKeccak256FromWord256 0x456]
      insertMany (Proxy @AddressState) . M.fromList $ zip accts $ map (\cp -> blankAddressState{addressStateCodeHash = cp}) codePtrs
      resolveCodePtr (Just 0) (codePtrs !! 0) `shouldReturn` Just (codePtrs !! 0)
      resolveCodePtr (Just 0) (codePtrs !! 1) `shouldReturn` Just (codePtrs !! 1)
    it "should resolve an ancestor code pointer" . runStorM $ do
      let chainRelationships = [ (Just (0 :: Word256), ParentChainId $ Nothing)
                                ,(Just (1 :: Word256), ParentChainId $ Just 0)
                                ]
      insertMany (Proxy @ParentChainId) $ M.fromList chainRelationships
      let accts = [ Account 0xabc (Just 0)
                  , Account 0xdef (Just 1)
                  ]
      let codePtrs = [ SolidVMCode "Code_0" $ unsafeCreateKeccak256FromWord256 0x123
                      , CodeAtAccount (accts !! 0) "Ptr_0"
                      ]
      insertMany (Proxy @AddressState) . M.fromList $ zip accts $ map (\cp -> blankAddressState{addressStateCodeHash = cp}) codePtrs
      resolveCodePtr (Just 1) (codePtrs !! 1) `shouldReturn` Just (SolidVMCode "Ptr_0" $ unsafeCreateKeccak256FromWord256 0x123)
    it "should resolve child-chain code pointers to Nothing" . runStorM $ do
      let chainRelationships = [ (Just (0 :: Word256), ParentChainId $ Nothing)
                                ,(Just (1 :: Word256), ParentChainId $ Just 0)
                                ]
      insertMany (Proxy @ParentChainId) $ M.fromList chainRelationships
      let accts = [ Account 0xabc (Just 0)
                  , Account 0xdef (Just 1)
                  ]
      let codePtrs = [CodeAtAccount (accts !! 1) "Ptr_0"
                      , SolidVMCode "Code_0" $ unsafeCreateKeccak256FromWord256 0x123
                      ]
      insertMany (Proxy @AddressState) . M.fromList $ zip accts $ map (\cp -> blankAddressState{addressStateCodeHash = cp}) codePtrs
      resolveCodePtr (Just 0) (codePtrs !! 0) `shouldReturn` Nothing
    it "should resolve sibling-chain code pointers to Nothing" . runStorM $ do
      let chainRelationships = [ (Just (0 :: Word256), ParentChainId $ Nothing)
                                , (Just (1 :: Word256), ParentChainId $ Just 0)
                                , (Just (2 :: Word256), ParentChainId $ Just 0)
                                ]
      insertMany (Proxy @ParentChainId) $ M.fromList chainRelationships
      let accts = [ Account 0xabc (Just 1)
                  , Account 0xdef (Just 2)
                  ]
      let codePtrs = [ SolidVMCode "Code_0" $ unsafeCreateKeccak256FromWord256 0x123
                      , CodeAtAccount (accts !! 0) "Ptr_0"
                      ]
      insertMany (Proxy @AddressState) . M.fromList $ zip accts $ map (\cp -> blankAddressState{addressStateCodeHash = cp}) codePtrs
      resolveCodePtr (Just 2) (codePtrs !! 1) `shouldReturn` Nothing
    it "should resolve two-level (pointer to parent, parent to child) code pointer indirection to Nothing" . runStorM $ do
      let chainRelationships = [ (Just (0 :: Word256), ParentChainId $ Nothing)
                               , (Just (1 :: Word256), ParentChainId $ Just 0)
                               , (Just (2 :: Word256), ParentChainId $ Just 0)
                               ]
      insertMany (Proxy @ParentChainId) $ M.fromList chainRelationships
      let accts = [ Account 0xabc (Just 1)
                  , Account 0xdef (Just 0)
                  , Account 0xfff (Just 2)
                  ]
      let codePtrs = [SolidVMCode "Code_0" $ unsafeCreateKeccak256FromWord256 0x123
                      , CodeAtAccount (accts !! 0) "Ptr_0"
                      , CodeAtAccount (accts !! 1) "Ptr_1"]
      insertMany (Proxy @AddressState) . M.fromList $ zip accts $ map (\cp -> blankAddressState{addressStateCodeHash = cp}) codePtrs
      resolveCodePtr (Just 2) (codePtrs !! 2) `shouldReturn` Nothing
