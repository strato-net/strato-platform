{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE BangPatterns         #-}
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
import           Control.Monad.Trans
import           Control.Monad.Trans.Except
import           Control.Monad.Trans.State    hiding (state)
import qualified Data.ByteString              as B
import qualified Data.ByteString.Base16       as B16
import qualified Data.ByteString.Unsafe       as BU
import           Data.IORef
import qualified Data.Vector                  as DV
import qualified Data.Vector.Storable.Mutable as V
import           Data.Word
import           Foreign
import           System.Exit
--import Text.PrettyPrint.ANSI.Leijen hiding ((<$>))

import qualified Blockchain.Colors            as CL
import           Blockchain.ExtWord
import           Blockchain.VM.OpcodePrices
import           Blockchain.VM.VMException
import           Blockchain.VM.VMM
import           Blockchain.VM.VMState

safeReadRange :: V.IOVector Word8 -> Int -> Int -> IO B.ByteString
safeReadRange v !offset !count = do
  let len = V.length v
  unless ((offset >= 0) && (count >= 0) && (fromIntegral (offset + count - 1) < len)) .
    die $ "reading out of range:" ++ show (offset, count, len)
  B.pack <$> mapM (V.unsafeRead v) [(fromIntegral offset)..(fromIntegral (offset + count - 1))]

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
  liftIO . when (newSize' > 0x7fffffffffffffff) . die $ "setNewMaxSize: " ++ show newSize'
  let newSize = 32 * ceiling (fromIntegral newSize'/(32::Double))::Integer
  state <- lift get

  oldSize <- liftIO $ readIORef (mSize $ memory state)


  let gasCharge = fromIntegral $
        if newSize > fromIntegral oldSize
        then
          let newWordSize = fromInteger $ (ceiling $ fromIntegral newSize/(32::Double))
              oldWordSize = (ceiling $ fromIntegral oldSize/(32::Double))
              sizeCost c = gMEMWORD * c + (c*c `quot` gQUADCOEFFDIV)
          in sizeCost newWordSize - sizeCost oldWordSize
          else 0

  let oldLength = fromIntegral $ V.length (mVector $ memory state)
  gr <- readGasRemaining $ state
  if gr < gasCharge
     then do
          setGasRemaining 0
          throwE OutOfGasException
    else do
    when (newSize > fromIntegral oldSize) $ do
      liftIO $ writeIORef (mSize $ memory state) (fromInteger newSize)
    if newSize > oldLength
      then do
        state' <- lift get
        when (newSize > 100000000) $ liftIO $ putStrLn $ CL.red ("Warning, memory needs to grow to a huge value: " ++ show (fromIntegral newSize/(1000000::Double)) ++ "MB")
        arr' <- liftIO $ V.grow (mVector $ memory state') $ fromIntegral $ (newSize+1000000)
        when (newSize > 100000000) $ liftIO $ putStrLn $ CL.red $ "clearing out memory"
        --liftIO $ forM_ [oldLength..(newSize+1000000)-1] $ \p -> V.write arr' (fromIntegral p) 0
        liftIO $ V.set (V.unsafeSlice (fromIntegral oldLength) (fromIntegral newSize+1000000) arr') 0
        when (newSize > 100000000) $ liftIO $ putStrLn $ CL.red $ "Finished growing memory"
        lift $ put $ state'{memory=(memory state'){mVector = arr'}}
      else return ()

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
  liftIO . when (p > fromIntegral (maxBound :: Int)) . die $ "mload: p is too large" ++ show p
  liftIO $ safeReadRange (mVector $ memory state) (fromIntegral p) 32

mLoadByteString::Word256->Word256->VMM B.ByteString
mLoadByteString _ 0 = return B.empty --no need to charge gas for mem change if nothing returned
mLoadByteString p size = do
  setNewMaxSize (fromIntegral p+fromIntegral size)
  state <- lift get
  liftIO . when (p > fromIntegral (maxBound :: Int)) . die $ "mloadbytestring: p is too large" ++ show p
  liftIO . when (size > fromIntegral (maxBound :: Int)) . die $ "mloadbytestring: size is too large" ++ show size
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
  let bytes = fastWord256ToBytes val
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
