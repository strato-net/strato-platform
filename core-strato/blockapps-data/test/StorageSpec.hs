module StorageSpec (storageSpec) where

import Test.Hspec

storageSpec :: Spec
storageSpec = do
  describe "StorageDB" $ do
    it "can run a test" $ do
      "ok" `shouldBe` "ok"

    -- type SMap = M.Map (Address, Word256) Word256
-- type AMap = M.Map Address AddressStateModification

-- data CachedStorage = CS
  -- { _sdb :: DB.DB
  -- , _sdbsr :: MP.StateRoot
  -- , _hdb :: HashDB
  -- , _stx :: SMap
  -- , _sbs :: SMap
  -- , _atx :: AMap
  -- , _abs :: AMap
  -- } deriving (Generic, NFData)
-- makeLenses ''CachedStorage

-- type StorM = StateT CachedStorage (ResourceT IO)

-- instance HasStorageDB StorM where
  -- getStorageTxDB = liftM2 (,) (use sdb) (use stx)
  -- putStorageTxMap = assign stx
  -- getStorageBlockDB = liftM2 (,) (use sdb) (use sbs)
  -- putStorageBlockMap = assign sbs

-- instance HasMemAddressStateDB StorM where
  -- getAddressStateTxDBMap = use atx
  -- putAddressStateTxDBMap = assign atx
  -- getAddressStateBlockDBMap = use abs
  -- putAddressStateBlockDBMap = assign abs

-- instance HasStateDB StorM where
  -- getStateDB = liftM2 MP.MPDB (use sdb) (use sdbsr)
  -- setStateDBStateRoot = assign sdbsr

-- instance HasHashDB StorM where
  -- getHashDB = use hdb

-- initialEnv :: IO (FilePath, CachedStorage)
-- initialEnv = do
  -- tmpdir <- mkdtemp "/tmp/initial_env"
  -- let ldbOptions = DB.defaultOptions { DB.createIfMissing = True }
    --   openDB b = DBB.open (tmpdir ++ b) ldbOptions
  -- s <- openDB stateDBPath
  -- h <- openDB hashDBPath
  -- let st = CS s MP.emptyTriePtr h M.empty M.empty M.empty M.empty
  -- fmap (tmpdir,) . runResourceT . flip execStateT st $ do
    -- MP.initializeBlank =<< getStateDB

-- benchStorM :: NFData a => String -> StorM a -> Benchmark
-- benchStorM name a = envWithCleanup initialEnv (\ ~(p, _) -> removePathForcibly p)
    --                                           (\ ~(_, s) -> bench name . nfIO $ runStorM s a)

