{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE MagicHash            #-}
{-# LANGUAGE BangPatterns         #-}
{-# OPTIONS -fno-warn-orphans #-}
module Blockchain.Strato.Model.ExtendedWord
 (
    Word64, Word128, Word160, Word256, Word512,
    word64ToBytes,  bytesToWord64,
    word128ToBytes, bytesToWord128,
    word160ToBytes, bytesToWord160,
    word256ToBytes, bytesToWord256, fastWord256ToBytes, fastBytesToWord256,
    word512ToBytes, bytesToWord512,
    fastWord256LSB
 ) where

import           Control.Monad
import qualified Data.Aeson                as Ae
import qualified Data.Aeson.Encoding       as Enc
import           Data.Binary
import           Data.Bits
import qualified Data.ByteArray            as BA
import qualified Data.ByteString           as B
import qualified Data.ByteString.Internal  as BI
import qualified Data.ByteString.Lazy      as BL
import qualified Data.ByteString.Base16    as B16
import qualified Data.ByteString.Char8     as BC
import           Data.Ix
import qualified Data.Primitive.ByteArray  as PBA
import qualified Data.Text                 as T
import           Foreign.ForeignPtr
import           Foreign.Ptr
import qualified Foreign.Storable          as FS
import           GHC.Exts
import           GHC.Integer.GMP.Internals
import           GHC.Word
import           System.Endian
import           System.IO.Unsafe

import           Network.Haskoin.Internals (Word128, Word160, Word256, Word512, BigWord(..))
import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.Format

word64ToBytes :: Word64 -> [Word8]
word64ToBytes word = map (fromIntegral . (word `shiftR`)) [64-8, 64-16..0]

bytesToWord64 :: [Word8] -> Word64
bytesToWord64 bytes | length bytes == 8 =
  sum $ map (\(shiftBits, byte) -> fromIntegral byte `shiftL` shiftBits) $ zip [64-8,64-16..0] bytes
bytesToWord64 _ = error "bytesToWord64 was called with the wrong number of bytes"

word128ToBytes :: Word128 -> [Word8]
word128ToBytes word = map (fromIntegral . (word `shiftR`)) [128-8, 128-16..0]

bytesToWord128 :: [Word8] -> Word128
bytesToWord128 bytes | length bytes == 16 =
  sum $ map (\(shiftBits, byte) -> fromIntegral byte `shiftL` shiftBits) $ zip [128-8,128-16..0] bytes
bytesToWord128 _ = error "bytesToWord128 was called with the wrong number of bytes"

word160ToBytes :: Word160 -> [Word8]
word160ToBytes word = map (fromIntegral . (word `shiftR`)) [160-8, 160-16..0]

bytesToWord160 :: [Word8] -> Word160
bytesToWord160 bytes | length bytes == 20 =
  sum $ map (\(shiftBits, byte) -> fromIntegral byte `shiftL` shiftBits) $ zip [160-8,160-16..0] bytes
bytesToWord160 _ = error "bytesToWord160 was called with the wrong number of bytes"

word256ToBytes :: Word256 -> [Word8]
word256ToBytes word = map (fromIntegral . (word `shiftR`)) [256-8, 256-16..0]

fastWord256ToBytes :: Word256 -> B.ByteString
fastWord256ToBytes ws = unsafePerformIO $ do
  let n = getBigWordInteger ws
  dstFP <- mallocForeignPtrBytes 32 :: IO (ForeignPtr Word8)
  withForeignPtr dstFP $ \dst' -> do
    let dst = castPtr dst' :: Ptr Word64
    FS.pokeElemOff dst 0 0
    FS.pokeElemOff dst 1 0
    FS.pokeElemOff dst 2 0
    FS.pokeElemOff dst 3 0
    case n of
      S# i# -> FS.pokeElemOff dst 3 (toBE64 (W64# (int2Word# i#)))
      Jp# bn -> do
        case sizeofBigNat# bn of
          1# -> do
            FS.pokeElemOff dst 3 (toBE64 (W64# (indexBigNat# bn 0#)))
          2# -> do
            FS.pokeElemOff dst 3 (toBE64 (W64# (indexBigNat# bn 0#)))
            FS.pokeElemOff dst 2 (toBE64 (W64# (indexBigNat# bn 1#)))
          3# -> do
            FS.pokeElemOff dst 3 (toBE64 (W64# (indexBigNat# bn 0#)))
            FS.pokeElemOff dst 2 (toBE64 (W64# (indexBigNat# bn 1#)))
            FS.pokeElemOff dst 1 (toBE64 (W64# (indexBigNat# bn 2#)))
          _ -> do
            FS.pokeElemOff dst 3 (toBE64 (W64# (indexBigNat# bn 0#)))
            FS.pokeElemOff dst 2 (toBE64 (W64# (indexBigNat# bn 1#)))
            FS.pokeElemOff dst 1 (toBE64 (W64# (indexBigNat# bn 2#)))
            FS.pokeElemOff dst 0 (toBE64 (W64# (indexBigNat# bn 3#)))
      _ -> error "negative Word256"
  return $! BI.PS dstFP 0 32

bytesToWord256 :: [Word8] -> Word256
bytesToWord256 bytes | length bytes == 32 =
  sum $ map (\(shiftBits, byte) -> fromIntegral byte `shiftL` shiftBits) $ zip [256-8,256-16..0] bytes
                     | otherwise = error $
                        "bytesToWord256 was called with the wrong number of bytes: " ++ show bytes

fastBytesToWord256 :: B.ByteString -> Word256
fastBytesToWord256 bytes | B.length bytes /= 32 = error $ "bytesToWord256f called with the wrong number of bytes: " ++ show bytes
                         | otherwise = unsafePerformIO $
  (BA.withByteArray bytes :: (Ptr Word64 -> IO Word256) -> IO Word256) $ \src -> do
    hh <- fromBE64 <$!> FS.peekElemOff src 0
    hl <- fromBE64 <$!> FS.peekElemOff src 1
    lh <- fromBE64 <$!> FS.peekElemOff src 2
    ll <- fromBE64 <$!> FS.peekElemOff src 3
    let numWords = case () of
                      () | hh .|. hl .|. lh == 0 -> 1
                         | hh .|. hl == 0 -> 2
                         | hh == 0 -> 3
                         | otherwise -> 4
    -- This branch is not technically needed as a Jp# can
    -- accept 1 word ByteArrays. I'm presuming that
    -- its cheaper to use S# than to allocate pinned memory,
    -- but that may only be for avoiding the problems of memory
    -- fragmentation.
    if numWords == 1 && ll <= 0x7fffffffffffffff
      then let !(W64# w#) = ll
           in return (BigWord (S# (word2Int# w#)))
      else do
        dst <- PBA.newPinnedByteArray (8 * numWords)
        case numWords of
          1 -> PBA.writeByteArray dst 0 ll
          2 -> do
            PBA.writeByteArray dst 0 ll
            PBA.writeByteArray dst 1 lh
          3 -> do
            PBA.writeByteArray dst 0 ll
            PBA.writeByteArray dst 1 lh
            PBA.writeByteArray dst 2 hl
          4 -> do
            PBA.writeByteArray dst 0 ll
            PBA.writeByteArray dst 1 lh
            PBA.writeByteArray dst 2 hl
            PBA.writeByteArray dst 3 hh
          _ -> error $ "unexpected number of words in word256: " ++ show numWords
        dst' <- PBA.unsafeFreezeByteArray dst
        let !(PBA.ByteArray dst'#) = dst'
        return . BigWord $ Jp# (BN# dst'#)

fastWord256LSB :: Word256 -> Word8
fastWord256LSB ws = case (getBigWordInteger ws) of
                      S# i# -> W8# (int2Word# (andI# i# 0xff#))
                      Jp# bn -> let w# = bigNatToWord bn
                                in W8# (and# w# (int2Word# 0xff#))
                      _ -> error "negative Word256"

word512ToBytes :: Word512 -> [Word8]
word512ToBytes word = map (fromIntegral . (word `shiftR`)) [512-8, 512-16..0]

bytesToWord512 :: [Word8] -> Word512
bytesToWord512 bytes | length bytes == 64 =
  sum $ map (\(shiftBits, byte) -> fromIntegral byte `shiftL` shiftBits) $ zip [512-8,512-16..0] bytes
bytesToWord512 _ = error "bytesToWord256 was called with the wrong number of bytes"

instance Ix Word256 where
    range (x, y) | x == y = [x]
    range (x, y) = x:range (x+1, y)
    index (x, y) z | z < x || z > y = error $ "Ix{Word256}.index: Index (" ++ show z ++ ") out of range ((" ++ show x ++ "," ++ show y ++ "))"
    index (x, _) z = fromIntegral $ z - x
    inRange (x, y) z | z >= x && z <= y = True
    inRange _ _      = False


instance RLPSerializable Word512 where
    rlpEncode val = RLPString $ BL.toStrict $ encode val

    rlpDecode (RLPString s) | B.length s == 64 = decode $ BL.fromStrict s
    rlpDecode x             = error ("Missing case in rlp2Word512: " ++ show x)

instance RLPSerializable Word256 where
    rlpEncode = rlpEncode . toInteger
    rlpDecode = fromInteger . rlpDecode

instance RLPSerializable Word128 where
    rlpEncode val = RLPString $ BL.toStrict $ encode val

    rlpDecode (RLPString s) | B.null s = 0
    rlpDecode (RLPString s) | B.length s <= 16 = decode $ BL.fromStrict s
    rlpDecode x             = error ("Missing case in rlp2Word128: " ++ show x)

instance RLPSerializable Word32 where
    rlpEncode val = RLPString $ BL.toStrict $ encode val

    rlpDecode (RLPString s) | B.null s = 0
    rlpDecode (RLPString s) | B.length s <= 4 = decode $ BL.fromStrict s
    rlpDecode x             = error ("Missing case in rlp2Word32: " ++ show x)

instance RLPSerializable Word16 where
    rlpEncode val = RLPString $ BL.toStrict $ encode val

    rlpDecode (RLPString s) | B.null s = 0
    rlpDecode (RLPString s) | B.length s <= 2 = decode $ BL.fromStrict s
    rlpDecode x             = error ("Missing case in rlp2Word16: " ++ show x)

instance Format Word256 where
  format x = BC.unpack $ B16.encode $ B.pack $ word256ToBytes x

instance Ae.ToJSONKey Word256 where
  toJSONKey = Ae.ToJSONKeyText f (Enc.text . f)
    where f = T.pack . format

instance Ae.FromJSONKey Word256 where
    fromJSONKey = Ae.FromJSONKeyTextParser (Ae.parseJSON . Ae.String)
