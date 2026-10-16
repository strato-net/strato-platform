{-# LANGUAGE ForeignFunctionInterface #-}

-- | Thin bindings to the C Merkle Patricia store (cbits/mp_trie.c).
--
-- The store owns the trie nodes: an in-memory cache in front of LevelDB,
-- written through on 'tick' / 'flush'.  Haskell hands over a state root and
-- raw key / RLP-serialized value bytes and gets a state root back.
--
-- A process activates the C trie by opening a store and calling
-- 'setActiveHandle'; the drop-in "Blockchain.Database.MerklePatricia" and
-- "BatchMerge" modules dispatch to it when set and to the Haskell
-- implementation otherwise.
module Blockchain.Database.MerklePatriciaNative
  ( MPHandle,
    openMemory,
    openLevelDB,
    close,

    -- * Active store
    activeHandle,
    setActiveHandle,

    -- * Trie operations (Left = hash of a node nobody has)
    getKeyVal,
    putManyKeyVal,
    deleteKey,
    tick,
    flush,

    -- * Walks
    forEach,
    dbDiff,
    getProof,

    -- * Nodes the store lacks
    setFetcher,

    -- * Raw nodes by hash
    lookupNode,
    insertNode,
    deleteNode,

    -- * Sandbox
    overlayBegin,
    overlayEnd,
  )
where

import Data.ByteString (ByteString)
import qualified Data.ByteString as B
import qualified Data.ByteString.Unsafe as BU
import Data.IORef
import Data.Word (Word8)
import Foreign.C.Types
import Control.Exception (SomeException, finally, mask_, onException, throwIO, try)
import Control.Concurrent.MVar
import Control.Monad (when)
import Foreign.C.String (CString, peekCString)
import Foreign.Marshal.Alloc (alloca, allocaBytes, mallocBytes)
import Foreign.Marshal.Array (allocaArray, peekArray, pokeArray)
import Foreign.Marshal.Utils (copyBytes)
import Foreign.Ptr
import Foreign.Storable
import System.IO.Unsafe (unsafePerformIO)

data MPHandle = MPHandle
  (Ptr ())
  (MVar ())
  (IORef (FunPtr FetchFn))
  (IORef (Maybe SomeException))

-- Keep each call and its error retrieval together, including callback failures.
withHandle :: MPHandle -> (Ptr () -> IO a) -> IO a
withHandle (MPHandle p lock _ exception) f = withMVar lock $ \_ -> mask_ $
  f p `onException` do
    pending <- readIORef exception
    writeIORef exception Nothing
    maybe (pure ()) throwIO pending

-- Exceptions cannot unwind through C; save them and rethrow in withHandle.
callback :: MPHandle -> IO CInt -> IO CInt
callback (MPHandle _ _ _ exception) action = do
  outcome <- try action
  case outcome of
    Right rc -> pure rc
    Left e -> writeIORef exception (Just e) >> pure (-1)

newHandle :: Ptr () -> IO MPHandle
newHandle p
  | p == nullPtr = throwIO (userError "mp_trie: could not allocate store")
  | otherwise = MPHandle p <$> newMVar () <*> newIORef nullFunPtr <*> newIORef Nothing

foreign import ccall unsafe "mp_db_open"
  c_open :: Ptr () -> CUInt -> CUInt -> IO (Ptr ())

foreign import ccall safe "mp_db_close"
  c_close :: Ptr () -> IO ()

foreign import ccall safe "mp_db_get_key_val"
  c_get :: Ptr () -> Ptr Word8 -> Ptr Word8 -> CSize -> Ptr (Ptr Word8) -> Ptr CSize -> IO CInt

foreign import ccall safe "mp_db_put_many_key_val"
  c_put_many ::
    Ptr () -> Ptr Word8 -> CSize ->
    Ptr (Ptr Word8) -> Ptr CSize -> Ptr (Ptr Word8) -> Ptr CSize ->
    Ptr Word8 -> Ptr Word8 -> IO CInt

foreign import ccall safe "mp_db_delete_key"
  c_delete :: Ptr () -> Ptr Word8 -> Ptr Word8 -> CSize -> Ptr Word8 -> IO CInt

foreign import ccall safe "mp_db_tick"
  c_tick :: Ptr () -> IO CInt

foreign import ccall safe "mp_db_flush"
  c_flush :: Ptr () -> IO CInt

foreign import ccall safe "mp_db_lookup_node"
  c_node_get :: Ptr () -> Ptr Word8 -> Ptr (Ptr Word8) -> Ptr CSize -> IO CInt

foreign import ccall unsafe "mp_db_insert_node"
  c_node_put :: Ptr () -> Ptr Word8 -> Ptr Word8 -> CSize -> IO CInt

foreign import ccall safe "mp_db_delete_node"
  c_node_delete :: Ptr () -> Ptr Word8 -> IO CInt

type KvFn = Ptr () -> Ptr Word8 -> CSize -> Ptr Word8 -> CSize -> IO CInt

foreign import ccall "wrapper"
  mkKvFn :: KvFn -> IO (FunPtr KvFn)

foreign import ccall safe "mp_db_for_each"
  c_for_each :: Ptr () -> Ptr Word8 -> FunPtr KvFn -> Ptr () -> IO CInt

type DiffFn = Ptr () -> CInt -> Ptr Word8 -> CSize -> Ptr Word8 -> CSize -> Ptr Word8 -> CSize -> IO CInt

foreign import ccall "wrapper"
  mkDiffFn :: DiffFn -> IO (FunPtr DiffFn)

foreign import ccall safe "mp_db_diff"
  c_diff :: Ptr () -> Ptr Word8 -> Ptr Word8 -> FunPtr DiffFn -> Ptr () -> IO CInt

type BytesFn = Ptr () -> Ptr Word8 -> CSize -> IO CInt

foreign import ccall "wrapper"
  mkBytesFn :: BytesFn -> IO (FunPtr BytesFn)

foreign import ccall safe "mp_db_get_proof"
  c_get_proof :: Ptr () -> Ptr Word8 -> Ptr Word8 -> CSize -> FunPtr BytesFn -> Ptr () -> Ptr (Ptr Word8) -> Ptr CSize -> IO CInt

type FetchFn = Ptr () -> Ptr Word8 -> Ptr (Ptr Word8) -> Ptr CSize -> IO CInt

foreign import ccall "wrapper"
  mkFetchFn :: FetchFn -> IO (FunPtr FetchFn)

foreign import ccall unsafe "mp_db_set_fetcher"
  c_set_fetcher :: Ptr () -> FunPtr FetchFn -> Ptr () -> IO ()

foreign import ccall unsafe "mp_db_overlay_begin"
  c_overlay_begin :: Ptr () -> IO ()

foreign import ccall unsafe "mp_db_overlay_end"
  c_overlay_end :: Ptr () -> IO ()

foreign import ccall unsafe "mp_db_missing_hash"
  c_missing_hash :: Ptr () -> Ptr Word8 -> IO ()

foreign import ccall unsafe "mp_db_error"
  c_error :: Ptr () -> IO CString

foreign import ccall unsafe "mp_free"
  c_free :: Ptr Word8 -> IO ()

-- | A store with no LevelDB behind it; nothing is ever evicted.
openMemory :: IO MPHandle
openMemory = c_open nullPtr 0 1 >>= newHandle

-- | @openLevelDB ldb capacity flushEvery@: cache up to @capacity@ clean
-- nodes over the @leveldb_t*@, writing new nodes through every
-- @flushEvery@ ticks.
openLevelDB :: Ptr () -> Int -> Int -> IO MPHandle
openLevelDB ldb capacity flushEvery =
  c_open ldb (fromIntegral capacity) (fromIntegral flushEvery) >>= newHandle

close :: MPHandle -> IO ()
close h@(MPHandle _ _ fetcher _) = withHandle h $ \p ->
  (c_flush p >>= check p "close") `finally` do
    c_close p
    cb <- readIORef fetcher
    when (cb /= nullFunPtr) (freeHaskellFunPtr cb)

{-# NOINLINE activeHandle #-}
activeHandle :: IORef (Maybe MPHandle)
activeHandle = unsafePerformIO $ newIORef Nothing

setActiveHandle :: Maybe MPHandle -> IO ()
setActiveHandle = writeIORef activeHandle

withBS :: ByteString -> (Ptr Word8 -> CSize -> IO a) -> IO a
withBS bs f = BU.unsafeUseAsCStringLen bs $ \(p, n) -> f (castPtr p) (fromIntegral n)

withBSs :: [ByteString] -> ([(Ptr Word8, CSize)] -> IO a) -> IO a
withBSs [] f = f []
withBSs (b : bs) f = withBS b $ \p n -> withBSs bs $ \rest -> f ((p, n) : rest)

-- | Copy out a C buffer and free it.
takeBS :: Ptr Word8 -> CSize -> IO ByteString
takeBS p n =
  B.packCStringLen (castPtr p, fromIntegral n) `finally` c_free p

missing :: Ptr () -> IO ByteString
missing p = allocaBytes 32 $ \h -> c_missing_hash p h >> B.packCStringLen (castPtr h, 32)

result :: Ptr () -> CInt -> IO a -> IO (Either ByteString a)
result p rc ok
  | rc == -2 = Left <$> missing p
  | rc < 0 = failure p ("operation failed (" ++ show rc ++ ")")
  | otherwise = Right <$> ok

failure :: Ptr () -> String -> IO a
failure p context = do
  message <- c_error p
  detail <- if message == nullPtr then pure context else peekCString message
  throwIO (userError ("mp_trie: " ++ detail))

-- | Value bytes for a key under a root.
getKeyVal :: MPHandle -> ByteString -> ByteString -> IO (Either ByteString (Maybe ByteString))
getKeyVal h root key = withHandle h $ \p ->
  withBS root $ \rootP _ -> withBS key $ \keyP keyN ->
    alloca $ \valPP -> alloca $ \valNP -> do
      rc <- c_get p rootP keyP keyN valPP valNP
      result p rc $
        if rc == 1
          then return Nothing
          else do
            valP <- peek valPP
            valN <- peek valNP
            Just <$> takeBS valP valN

-- | Insert key/value pairs under a root; the new root and, per pair,
-- whether the key already had a value.
putManyKeyVal :: MPHandle -> ByteString -> [(ByteString, ByteString)] -> IO (Either ByteString (ByteString, [Bool]))
putManyKeyVal h root kvs = withHandle h $ \p ->
  withBS root $ \rootP _ ->
    withBSs (map fst kvs) $ \keys -> withBSs (map snd kvs) $ \vals ->
      allocaArray n $ \keyPs -> allocaArray n $ \keyNs ->
        allocaArray n $ \valPs -> allocaArray n $ \valNs ->
          allocaBytes 32 $ \newRoot -> allocaArray n $ \existed -> do
            pokeArray keyPs (map fst keys)
            pokeArray keyNs (map snd keys)
            pokeArray valPs (map fst vals)
            pokeArray valNs (map snd vals)
            rc <- c_put_many p rootP (fromIntegral n) keyPs keyNs valPs valNs newRoot existed
            result p rc $ do
              root' <- B.packCStringLen (castPtr newRoot, 32)
              ex <- peekArray n existed
              return (root', map (/= (0 :: Word8)) ex)
  where
    n = length kvs

deleteKey :: MPHandle -> ByteString -> ByteString -> IO (Either ByteString ByteString)
deleteKey h root key = withHandle h $ \p ->
  withBS root $ \rootP _ -> withBS key $ \keyP keyN -> allocaBytes 32 $ \newRoot -> do
    rc <- c_delete p rootP keyP keyN newRoot
    result p rc $ B.packCStringLen (castPtr newRoot, 32)

-- | A block is done; the store may write pending nodes through.
tick :: MPHandle -> IO ()
tick h = withHandle h $ \p -> c_tick p >>= check p "tick"

-- | Write every pending node through now.
flush :: MPHandle -> IO ()
flush h = withHandle h $ \p -> c_flush p >>= check p "flush"

check :: Ptr () -> String -> CInt -> IO ()
check p what rc
  | rc == 0 = return ()
  | otherwise = failure p (what ++ " failed: " ++ show rc)

-- | Every key (as nibbles) and value under a root, in trie order.
forEach :: MPHandle -> ByteString -> IO (Either ByteString [([Word8], ByteString)])
forEach h root = withHandle h $ \p -> do
  acc <- newIORef []
  cb <- mkKvFn $ \_ kP kN vP vN -> callback h $ do
    k <- peekArray (fromIntegral kN) kP
    v <- B.packCStringLen (castPtr vP, fromIntegral vN)
    modifyIORef' acc ((k, v) :)
    return 0
  rc <- withBS root $ \rootP _ -> c_for_each p rootP cb nullPtr
  freeHaskellFunPtr cb
  result p rc $ reverse <$> readIORef acc

-- | The changes from the trie at the first root to the trie at the second:
-- key nibbles, old value, new value.
dbDiff :: MPHandle -> ByteString -> ByteString -> IO (Either ByteString [([Word8], Maybe ByteString, Maybe ByteString)])
dbDiff h a b = withHandle h $ \p -> do
  acc <- newIORef []
  cb <- mkDiffFn $ \_ op kP kN oP oN nP nN -> callback h $ do
    k <- peekArray (fromIntegral kN) kP
    o <- if op == 0 then return Nothing else Just <$> B.packCStringLen (castPtr oP, fromIntegral oN)
    n <- if op == 2 then return Nothing else Just <$> B.packCStringLen (castPtr nP, fromIntegral nN)
    modifyIORef' acc ((k, o, n) :)
    return 0
  rc <- withBS a $ \aP _ -> withBS b $ \bP _ -> c_diff p aP bP cb nullPtr
  freeHaskellFunPtr cb
  result p rc $ reverse <$> readIORef acc

-- | The value under an unhashed key and the hashed nodes on the way to it,
-- root first.
getProof :: MPHandle -> ByteString -> ByteString -> IO (Either ByteString (Maybe ByteString, [ByteString]))
getProof h root key = withHandle h $ \p -> do
  acc <- newIORef []
  cb <- mkBytesFn $ \_ dP dN -> callback h $ do
    d <- B.packCStringLen (castPtr dP, fromIntegral dN)
    modifyIORef' acc (d :)
    return 0
  r <- (withBS root $ \rootP _ -> withBS key $ \keyP keyN ->
    alloca $ \valPP -> alloca $ \valNP -> do
      rc <- c_get_proof p rootP keyP keyN cb nullPtr valPP valNP
      result p rc $ do
        valP <- peek valPP
        if valP == nullPtr
          then return Nothing
          else Just <$> (peek valNP >>= takeBS valP)) `finally` freeHaskellFunPtr cb
  nodes <- reverse <$> readIORef acc
  return $ (\v -> (v, nodes)) <$> r

-- | Ask @fetch@ for nodes the store lacks (and keep them); @Nothing@
-- clears. The callback runs under the store lock and may not use the
-- store; exceptions are rethrown after returning from C.
setFetcher :: MPHandle -> Maybe (ByteString -> IO (Maybe ByteString)) -> IO ()
setFetcher h@(MPHandle _ _ fetcherPtr _) mfetch = withHandle h $ \p -> do
  old <- readIORef fetcherPtr
  new <- case mfetch of
    Nothing -> return nullFunPtr
    Just fetch -> mkFetchFn $ \_ hP outPP outNP -> callback h $ do
      hash <- B.packCStringLen (castPtr hP, 32)
      value <- fetch hash
      case value of
        Just bs -> do
          buf <- mallocBytes (B.length bs)
          withBS bs $ \src n -> copyBytes buf src (fromIntegral n)
          poke outPP buf
          poke outNP (fromIntegral $ B.length bs)
          return 0
        Nothing -> return 1
  c_set_fetcher p new nullPtr
  writeIORef fetcherPtr new
  if old == nullFunPtr then return () else freeHaskellFunPtr old

-- | Raw node bytes by hash (cache, then LevelDB).
lookupNode :: MPHandle -> ByteString -> IO (Maybe ByteString)
lookupNode h hash = withHandle h $ \p ->
  withBS hash $ \hashP _ -> alloca $ \dataPP -> alloca $ \dataNP -> do
    rc <- c_node_get p hashP dataPP dataNP
    if rc < 0 then failure p "lookup node failed" else if rc == 1
      then return Nothing
      else do
        dataP <- peek dataPP
        dataN <- peek dataNP
        Just <$> takeBS dataP dataN

insertNode :: MPHandle -> ByteString -> ByteString -> IO ()
insertNode h hash bytes = withHandle h $ \p ->
  withBS hash $ \hashP _ -> withBS bytes $ \dataP dataN ->
    c_node_put p hashP dataP dataN >>= check p "nodePut"

deleteNode :: MPHandle -> ByteString -> IO ()
deleteNode h hash = withHandle h $ \p ->
  withBS hash $ \hashP _ -> c_node_delete p hashP >>= check p "nodeDelete"

-- | Nodes created until the matching 'overlayEnd' are never written through.
overlayBegin, overlayEnd :: MPHandle -> IO ()
overlayBegin h = withHandle h c_overlay_begin
overlayEnd h = withHandle h c_overlay_end
