{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE BangPatterns         #-}
{-# LANGUAGE MagicHash            #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TemplateHaskell      #-}
module Blockchain.VM.Memory (
  Memory(..),
  getSizeInBytes,
  getSizeInWords,
  getShow,
  getMemAsByteString,
  mLoad,
  mLoadByteString,
  unsafeSliceByteString,
  mStore,
  mStore8,
  mStoreByteString
  ) where

import           Control.Monad
import           Control.Monad.Logger
import           Control.Monad.Trans
import           Control.Monad.Trans.Except
import           Control.Monad.Trans.State    hiding (state)
import qualified Data.ByteString              as B
import qualified Data.ByteString.Internal              as BI
import qualified Data.ByteString.Base16       as B16
import qualified Data.ByteString.Unsafe       as BU
import           Data.IORef
import qualified Data.Text                    as T
import qualified Data.Vector                  as DV
import qualified Data.Vector.Storable.Mutable as V
import           Data.Word
import           Foreign
import           System.Exit

import qualified Blockchain.Colors            as CL
import           Blockchain.ExtWord
import           Blockchain.VM.OpcodePrices
import           Blockchain.VM.VMException
import           Blockchain.VM.VMM
import           Blockchain.VM.VMState

safeReadRange :: V.IOVector Word8 -> Int -> Int -> IO B.ByteString
safeReadRange v !offset !count = do
  let len = V.length v
  unless ((offset >= 0) && (count >= 0) && (offset + count - 1 < len)) .
    die $ "programmer error: reading out of range:" ++ show (offset, count, len)
  dstFP <- BI.mallocByteString count
  withForeignPtr dstFP $ \dst ->
    V.unsafeWith v $ \src ->
       BI.memcpy dst (plusPtr src offset) count
  return $! BI.PS dstFP 0 count

getSizeInWords::VMM Word256
getSizeInWords = do
  state <- lift get
  let (Memory _ size) = memory state
  liftIO $ (ceiling . (/ (32::Double)) . fromIntegral) <$> readIORef size

getSizeInBytes::VMM Word256
getSizeInBytes = do
  state <- lift get
  let (Memory _ size) = memory state
  liftIO $ fromIntegral <$> readIORef size

--In this function I use the words "size" and "length" to mean 2 different things....
--"size" is the highest memory location used (as described in the yellowpaper).
--"length" is the IOVector length, which will often be larger than the size.
--Basically, to avoid resizing the vector constantly (which could be expensive),
--I keep something larger around until it fills up, then reallocate (something even
--larger).
setNewMaxSize::Integer->VMM ()
setNewMaxSize newSize' = do
  --TODO- I should just store the number of words....  memory size can only be a multiple of words.
  --For now I will just use this hack to allocate to the nearest higher number of words.
  when (newSize' > 0x7fffffffffffffff) $ do
    $logErrorS "setNewMaxSize" . T.pack $ "unable to cast to int: " ++ show newSize'
    throwE OutOfGasException
  let !newSize = 32 * ceiling (fromIntegral newSize'/(32::Double))::Int
  state <- lift get
  oldSize <- liftIO $ readIORef (mSize $ memory state)
  when (oldSize < newSize) $ do
    let gasCharge = fromIntegral $
          let newWordSize = ceiling $ fromIntegral newSize/(32::Double)
              oldWordSize = ceiling $ fromIntegral oldSize/(32::Double)
              sizeCost c = gMEMWORD * c + (c*c `quot` gQUADCOEFFDIV)
          in sizeCost newWordSize - sizeCost oldWordSize
    let oldLength = V.length (mVector $ memory state)
    gr <- readGasRemaining $ state
    when (gr < gasCharge) $ do
      setGasRemaining 0
      throwE OutOfGasException
    liftIO $ writeIORef (mSize $ memory state) newSize
    when (newSize > oldLength) $ do
      state' <- lift get
      let newLength = 2 * newSize
      when (newSize > 100000000) $ liftIO $ putStrLn $ CL.red ("Warning, memory needs to grow to a huge value: " ++ show (fromIntegral newSize/(1000000::Double)) ++ "MB")
      arr' <- liftIO $ V.grow (mVector $ memory state') $ fromIntegral $ newLength
      when (newSize > 100000000) $ liftIO $ putStrLn $ CL.red $ "clearing out memory"
      liftIO $ V.set (V.unsafeSlice (fromIntegral oldLength) newLength arr') 0
      when (newSize > 100000000) $ liftIO $ putStrLn $ CL.red $ "Finished growing memory"
      lift $ put $ state'{memory=(memory state'){mVector = arr'}}
    useGas gasCharge

getShow::Memory->IO String
getShow (Memory arr sizeRef) = do
  msize <- readIORef sizeRef
  --fmap (show . B16.encode . B.pack) $ sequence $ V.read arr <$> fromIntegral <$> [0..fromIntegral msize-1]
  fmap (show . B16.encode) $ safeReadRange arr 0 msize

getMemAsByteString::Memory->IO B.ByteString
getMemAsByteString (Memory arr sizeRef) = do
  msize <- readIORef sizeRef
  safeReadRange arr 0 msize

mLoad::Word256->VMM B.ByteString
mLoad p = do
  setNewMaxSize (fromIntegral p+32)
  state <- lift get
  liftIO $ safeReadRange (mVector $ memory state) (fromIntegral p) 32

mLoadByteString::Word256->Word256->VMM B.ByteString
mLoadByteString _ 0 = return B.empty --no need to charge gas for mem change if nothing returned
mLoadByteString p size = do
  setNewMaxSize (fromIntegral p+fromIntegral size)
  state <- lift get
  val <- liftIO $ safeReadRange (mVector $ memory state) (fromIntegral p) (fromIntegral size)
  return val

unsafeSliceByteString::Word256->Word256->VMM B.ByteString
unsafeSliceByteString _ 0 = return $ B.empty
unsafeSliceByteString p size = do
  setNewMaxSize (fromIntegral p+fromIntegral size)
  state <- lift get
  let (fptr, len) = V.unsafeToForeignPtr0 (V.slice (fromIntegral p) (fromIntegral size) $ mVector $ memory state)
  liftIO $ withForeignPtr fptr $ \ptr ->
    B.packCStringLen (castPtr ptr, len * sizeOf (undefined :: Word8))


mStore::Word256->Word256->VMM ()
mStore p val = do
  setNewMaxSize (fromIntegral p+32)
  state <- lift get
  let bytes = word256ToBytes val
      mem = mVector $! memory state
  liftIO $ V.unsafeWith mem $ \dst ->
             -- bytes is not null terminated, so this isn't a real C String.
             -- That's not a problem, because we know how long it is.
             BU.unsafeUseAsCString bytes $ \src ->
               copyBytes (plusPtr dst (fromIntegral p)) src 32

mStore8::Word256->Word8->VMM ()
mStore8 p val = do
  setNewMaxSize (fromIntegral p+1)
  state <- lift get
  liftIO $ V.write (mVector $ memory state) (fromIntegral p) val

mStoreByteString::Word256->B.ByteString->VMM ()
mStoreByteString _ theData | B.null theData = return () --no need to charge gas for mem change if nothing set
mStoreByteString p theData = do
  setNewMaxSize (fromIntegral p + fromIntegral (B.length theData))
  state <- lift get
  let sr = DV.enumFromN (fromIntegral p) (B.length theData) -- fromIntegral <$> sr'
      up = DV.fromList $ B.unpack theData
  liftIO $ DV.zipWithM_ (\i d -> V.unsafeWrite (mVector $ memory state) i d) sr up
