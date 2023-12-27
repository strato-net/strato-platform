{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MagicHash #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}

module Blockchain.EVM.Memory
  ( Memory (..),
    getSizeInBytes,
    getSizeInWords,
    --  getShow,
    getMemAsByteString,
    mLoad,
    mLoadByteString,
    unsafeSliceByteString,
    mStore,
    mStore8,
    mStoreByteString,
  )
where

--import qualified Data.ByteString.Base16       as B16

import BlockApps.Logging
import Blockchain.EVM.OpcodePrices
import Blockchain.EVM.VMM
import Blockchain.EVM.VMState
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.VM.VMException
import Control.Monad
import Control.Monad.Trans
import qualified Data.ByteString as B
import qualified Data.ByteString.Internal as BI
import qualified Data.ByteString.Unsafe as BU
import qualified Data.Text as T
import qualified Data.Vector as DV
import qualified Data.Vector.Storable.Mutable as V
import Data.Word
import Foreign
import qualified Foreign.Marshal.Utils as FMU
import System.Exit
import qualified Text.Colors as CL
import UnliftIO

safeReadRange :: V.IOVector Word8 -> Int -> Int -> IO B.ByteString
safeReadRange v !offset !count = do
  let len = V.length v
  unless ((offset >= 0) && (count >= 0) && (offset + count - 1 < len))
    . die
    $ "programmer error: reading out of range:" ++ show (offset, count, len)
  dstFP <- BI.mallocByteString count
  withForeignPtr dstFP $ \dst ->
    V.unsafeWith v $ \src ->
      FMU.copyBytes dst (plusPtr src offset) count
  return $! BI.PS dstFP 0 count

getSizeInWords :: MonadIO m => VMM m Word256
getSizeInWords = do
  state <- vmstateGet
  let (Memory _ size) = memory state
  (ceiling . (/ (32 :: Double)) . fromIntegral) <$> readIORef size

getSizeInBytes :: MonadIO m => VMM m Word256
getSizeInBytes = do
  state <- vmstateGet
  let (Memory _ size) = memory state
  fromIntegral <$> readIORef size

--In this function I use the words "size" and "length" to mean 2 different things....
--"size" is the highest memory location used (as described in the yellowpaper).
--"length" is the IOVector length, which will often be larger than the size.
--Basically, to avoid resizing the vector constantly (which could be expensive),
--I keep something larger around until it fills up, then reallocate (something even
--larger).
setNewMaxSize :: (MonadLogger m, MonadIO m) => Integer -> VMM m ()
setNewMaxSize newSize' = do
  --TODO- I should just store the number of words....  memory size can only be a multiple of words.
  --For now I will just use this hack to allocate to the nearest higher number of words.
  when (newSize' > 0x7fffffffffffffff) $ do
    $logErrorS "setNewMaxSize" . T.pack $ "unable to cast to int: " ++ show newSize'
    throwIO OutOfGasException
  let !newSize = 32 * ceiling (fromIntegral newSize' / (32 :: Double)) :: Int
  state <- vmstateGet
  oldSize <- readIORef (mSize $ memory state)
  when (oldSize < newSize) $ do
    let gasCharge =
          fromIntegral $
            let newWordSize = ceiling $ fromIntegral newSize / (32 :: Double)
                oldWordSize = ceiling $ fromIntegral oldSize / (32 :: Double)
                sizeCost c = gMEMWORD * c + (c * c `quot` gQUADCOEFFDIV)
             in sizeCost newWordSize - sizeCost oldWordSize
    let oldLength = V.length (mVector $ memory state)
    gr <- readGasRemaining $ state
    when (gr < gasCharge) $ do
      setGasRemaining 0
      throwIO OutOfGasException
    writeIORef (mSize $ memory state) newSize
    when (newSize > oldLength) $ do
      state' <- vmstateGet
      let newLength = 2 * newSize
      when (newSize > 100000000) $ liftIO $ putStrLn $ CL.red ("Warning, memory needs to grow to a huge value: " ++ show (fromIntegral newSize / (1000000 :: Double)) ++ "MB")
      arr' <- liftIO $ V.grow (mVector $ memory state') $ fromIntegral $ newLength
      when (newSize > 100000000) $ liftIO $ putStrLn $ CL.red $ "clearing out memory"
      liftIO $ V.set (V.unsafeSlice (fromIntegral oldLength) newLength arr') 0
      when (newSize > 100000000) $ liftIO $ putStrLn $ CL.red $ "Finished growing memory"
      vmstatePut $ state' {memory = (memory state') {mVector = arr'}}
    useGas gasCharge

{-
getShow::Memory->IO String
getShow (Memory arr sizeRef) = do
  msize <- readIORef sizeRef
  --fmap (show . B16.encode . B.pack) $ sequence $ V.read arr <$> fromIntegral <$> [0..fromIntegral msize-1]
  fmap (show . B16.encode) $ safeReadRange arr 0 msize
-}

getMemAsByteString :: Memory -> IO B.ByteString
getMemAsByteString (Memory arr sizeRef) = do
  msize <- readIORef sizeRef
  safeReadRange arr 0 msize

mLoad :: (MonadIO m, MonadLogger m) => Word256 -> VMM m B.ByteString
mLoad p = do
  setNewMaxSize (fromIntegral p + 32)
  state <- vmstateGet
  liftIO $ safeReadRange (mVector $ memory state) (fromIntegral p) 32

mLoadByteString :: (MonadIO m, MonadLogger m) => Word256 -> Word256 -> VMM m B.ByteString
mLoadByteString _ 0 = return B.empty --no need to charge gas for mem change if nothing returned
mLoadByteString p size = do
  setNewMaxSize (fromIntegral p + fromIntegral size)
  state <- vmstateGet
  val <- liftIO $ safeReadRange (mVector $ memory state) (fromIntegral p) (fromIntegral size)
  return val

unsafeSliceByteString :: (MonadIO m, MonadLogger m) => Word256 -> Word256 -> VMM m B.ByteString
unsafeSliceByteString _ 0 = return $ B.empty
unsafeSliceByteString p size = do
  setNewMaxSize (fromIntegral p + fromIntegral size)
  state <- vmstateGet
  let (fptr, len) = V.unsafeToForeignPtr0 (V.slice (fromIntegral p) (fromIntegral size) $ mVector $ memory state)
  liftIO $
    withForeignPtr fptr $ \ptr ->
      B.packCStringLen (castPtr ptr, len * sizeOf (undefined :: Word8))

mStore :: (MonadIO m, MonadLogger m) => Word256 -> Word256 -> VMM m ()
mStore p val = do
  setNewMaxSize (fromIntegral p + 32)
  state <- vmstateGet
  let bytes = word256ToBytes val
      mem = mVector $! memory state
  liftIO $
    V.unsafeWith mem $ \dst ->
      -- bytes is not null terminated, so this isn't a real C String.
      -- That's not a problem, because we know how long it is.
      BU.unsafeUseAsCString bytes $ \src ->
        copyBytes (plusPtr dst (fromIntegral p)) src 32

mStore8 :: (MonadIO m, MonadLogger m) => Word256 -> Word8 -> VMM m ()
mStore8 p val = do
  setNewMaxSize (fromIntegral p + 1)
  state <- vmstateGet
  liftIO $ V.write (mVector $ memory state) (fromIntegral p) val

mStoreByteString :: (MonadIO m, MonadLogger m) => Word256 -> B.ByteString -> VMM m ()
mStoreByteString _ theData | B.null theData = return () --no need to charge gas for mem change if nothing set
mStoreByteString p theData = do
  setNewMaxSize (fromIntegral p + fromIntegral (B.length theData))
  state <- vmstateGet
  let sr = DV.enumFromN (fromIntegral p) (B.length theData) -- fromIntegral <$> sr'
      up = DV.fromList $ B.unpack theData
  liftIO $ DV.zipWithM_ (\i d -> V.unsafeWrite (mVector $ memory state) i d) sr up
