{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MagicHash #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeSynonymInstances #-}

{-# OPTIONS -fno-warn-orphans #-}
module Blockchain.Strato.Model.ExtendedWord
  ( Word64,
    Word128,
    Word160,
    Word256,
    Word512,
    word64ToBytes,
    bytesToWord64,
    word128ToBytes,
    bytesToWord128,
    word160ToBytes,
    bytesToWord160,
    slowWord256ToBytes,
    slowBytesToWord256,
    word256ToBytes,
    bytesToWord256,
    word512ToBytes,
    bytesToWord512,
    fastWord256LSB,
  )
where

import Blockchain.Data.RLP
import Control.Lens.Operators
import Control.Monad
import qualified Data.Aeson as Ae
import qualified Data.Aeson.Encoding as Enc
import qualified Data.Aeson.Key as DAK
import Data.Binary
import Data.Bits
import qualified Data.ByteArray as BA
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Internal as BI
import qualified Data.ByteString.Lazy as BL
import Data.Ix
import qualified Data.Primitive.ByteArray as PBA
import Data.Swagger hiding (Format, format)
import Data.Swagger.Internal.Schema (named)
import qualified Data.Text as T
import Foreign.ForeignPtr
import Foreign.Ptr
import qualified Foreign.Storable as FS
import GHC.Exts
import GHC.Integer.GMP.Internals
import GHC.Num.BigNat
import GHC.Num.Integer
import GHC.Word
import Network.Haskoin.Crypto.BigWord (BigWord (..), Word128, Word160, Word256, Word512)
import Numeric
import System.Endian
import System.IO.Unsafe
import Text.Format
import Web.HttpApiData

word64ToBytes :: Word64 -> [Word8]
word64ToBytes word = map (fromIntegral . (word `shiftR`)) [64 - 8, 64 - 16 .. 0]

bytesToWord64 :: [Word8] -> Word64
bytesToWord64 bytes
  | length bytes == 8 =
    sum $ map (\(shiftBits, byte) -> fromIntegral byte `shiftL` shiftBits) $ zip [64 - 8, 64 - 16 .. 0] bytes
bytesToWord64 _ = error "bytesToWord64 was called with the wrong number of bytes"

word128ToBytes :: Word128 -> [Word8]
word128ToBytes word = map (fromIntegral . (word `shiftR`)) [128 - 8, 128 - 16 .. 0]

bytesToWord128 :: [Word8] -> Word128
bytesToWord128 bytes
  | length bytes == 16 =
    sum $ map (\(shiftBits, byte) -> fromIntegral byte `shiftL` shiftBits) $ zip [128 - 8, 128 - 16 .. 0] bytes
bytesToWord128 _ = error "bytesToWord128 was called with the wrong number of bytes"

word160ToBytes :: Word160 -> [Word8]
word160ToBytes word = map (fromIntegral . (word `shiftR`)) [160 - 8, 160 - 16 .. 0]

bytesToWord160 :: [Word8] -> Word160
bytesToWord160 bytes
  | length bytes == 20 =
    sum $ map (\(shiftBits, byte) -> fromIntegral byte `shiftL` shiftBits) $ zip [160 - 8, 160 - 16 .. 0] bytes
bytesToWord160 _ = error "bytesToWord160 was called with the wrong number of bytes"

slowWord256ToBytes :: Word256 -> [Word8]
slowWord256ToBytes word = map (fromIntegral . (word `shiftR`)) [256 - 8, 256 - 16 .. 0]

word256ToBytes :: Word256 -> B.ByteString
word256ToBytes ws = unsafePerformIO $ do
  let n = getBigWordInteger ws
  dstFP <- BI.mallocByteString 32 :: IO (ForeignPtr Word8)
  withForeignPtr dstFP $ \dst' -> do
    let dst = castPtr dst' :: Ptr Word64
    FS.pokeElemOff dst 0 0
    FS.pokeElemOff dst 1 0
    FS.pokeElemOff dst 2 0
    FS.pokeElemOff dst 3 0
    case n of
      IS i# -> FS.pokeElemOff dst 3 (toBE64 (W64# (wordToWord64# (int2Word# i#))))
      IP bn -> do
        case bigNatSize# bn of
          1# -> do
            FS.pokeElemOff dst 3 (toBE64 (W64# (wordToWord64# (bigNatIndex# bn 0#))))
          2# -> do
            FS.pokeElemOff dst 3 (toBE64 (W64# (wordToWord64# (bigNatIndex# bn 0#))))
            FS.pokeElemOff dst 2 (toBE64 (W64# (wordToWord64# (bigNatIndex# bn 1#))))
          3# -> do
            FS.pokeElemOff dst 3 (toBE64 (W64# (wordToWord64# (bigNatIndex# bn 0#))))
            FS.pokeElemOff dst 2 (toBE64 (W64# (wordToWord64# (bigNatIndex# bn 1#))))
            FS.pokeElemOff dst 1 (toBE64 (W64# (wordToWord64# (bigNatIndex# bn 2#))))
          _ -> do
            FS.pokeElemOff dst 3 (toBE64 (W64# (wordToWord64# (bigNatIndex# bn 0#))))
            FS.pokeElemOff dst 2 (toBE64 (W64# (wordToWord64# (bigNatIndex# bn 1#))))
            FS.pokeElemOff dst 1 (toBE64 (W64# (wordToWord64# (bigNatIndex# bn 2#))))
            FS.pokeElemOff dst 0 (toBE64 (W64# (wordToWord64# (bigNatIndex# bn 3#))))
      _ -> error "negative Word256"
  return $! BI.PS dstFP 0 32

slowBytesToWord256 :: [Word8] -> Word256
slowBytesToWord256 bytes
  | length bytes == 32 =
    sum $ map (\(shiftBits, byte) -> fromIntegral byte `shiftL` shiftBits) $ zip [256 - 8, 256 - 16 .. 0] bytes
  | otherwise =
    error $
      "slowBytesToWord256 was called with the wrong number of bytes: " ++ show bytes

bytesToWord256 :: B.ByteString -> Word256
bytesToWord256 bytes
  | B.length bytes /= 32 = error $ "bytesToWord256 called with the wrong number of bytes: " ++ show bytes
  | otherwise = unsafePerformIO $
    (BA.withByteArray bytes :: (Ptr Word64 -> IO Word256) -> IO Word256) $ \src -> do
      hh <- fromBE64 <$!> FS.peekElemOff src 0
      hl <- fromBE64 <$!> FS.peekElemOff src 1
      lh <- fromBE64 <$!> FS.peekElemOff src 2
      ll <- fromBE64 <$!> FS.peekElemOff src 3
      let numWords = case () of
            ()
              | hh .|. hl .|. lh == 0 -> 1
              | hh .|. hl == 0 -> 2
              | hh == 0 -> 3
              | otherwise -> 4
      -- This branch is not technically needed as a Jp# can
      -- accept 1 word ByteArrays. I'm presuming that
      -- its cheaper to use S# than to allocate pinned memory,
      -- but that may only be for avoiding the problems of memory
      -- fragmentation.
      if numWords == 1 && ll <= 0x7fffffffffffffff
        then
          let !(W64# w#) = ll
              word# = word64ToWord# w# -- Convert Word64# to Word#
            in return (BigWord (IS (word2Int# word#)))
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
          return . BigWord $ IP (unBigNat (BN# dst'#))

fastWord256LSB :: Word256 -> Word8
fastWord256LSB (BigWord (IS i#)) = fromIntegral (W# (int2Word# i#))
-- fastWord256LSB (BigWord (Jp# bn)) = fromIntegral (W# (bigNatIndex# (unBigNat bn) 0#))
fastWord256LSB (BigWord (IP bn)) = fromIntegral (W# (bigNatIndex# bn 0#))
fastWord256LSB (BigWord (IN bn)) = fromIntegral (W# (bigNatIndex# bn 0#))

word512ToBytes :: Word512 -> [Word8]
word512ToBytes word = map (fromIntegral . (word `shiftR`)) [512 - 8, 512 - 16 .. 0]

bytesToWord512 :: [Word8] -> Word512
bytesToWord512 bytes
  | length bytes == 64 =
    sum $ map (\(shiftBits, byte) -> fromIntegral byte `shiftL` shiftBits) $ zip [512 - 8, 512 - 16 .. 0] bytes
bytesToWord512 _ = error "slowBytesToWord256 was called with the wrong number of bytes"

instance ToSchema Word256 where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "Word256")
        ( mempty
            & type_ ?~ SwaggerString
            & example ?~ "ec41a0a4da1f33ee9a757f4fd27c2a1a57313353375860388c66edc562ddc781"
            & description ?~ "Fixed-size words of 256 bits"
        )

instance ToParamSchema Word256 where
  toParamSchema _ = mempty & type_ ?~ SwaggerString

instance ToHttpApiData Word256 where
  toUrlPiece = T.pack . ("0x" ++) . flip showHex ""

instance Ix Word256 where
  range (x, y) | x == y = [x]
  range (x, y) = x : range (x + 1, y)
  index (x, y) z | z < x || z > y = error $ "Ix{Word256}.index: Index (" ++ show z ++ ") out of range ((" ++ show x ++ "," ++ show y ++ "))"
  index (x, _) z = fromIntegral $ z - x
  inRange (x, y) z | z >= x && z <= y = True
  inRange _ _ = False

instance FromHttpApiData Word160 where
  parseQueryParam v =
    case readHex $ T.unpack v of
      [(n, "")] -> Right n
      _ -> Left $ T.pack $ "Error parsing Word160: " ++ show v

instance RLPSerializable Word512 where
  rlpEncode val = RLPString $ BL.toStrict $ encode val

  rlpDecode (RLPString s) | B.length s == 64 = decode $ BL.fromStrict s
  rlpDecode x = error ("Missing case in rlp2Word512: " ++ show x)

instance RLPSerializable Word256 where
  rlpEncode = rlpEncode . toInteger
  rlpDecode = fromInteger . rlpDecode

instance RLPSerializable Word128 where
  rlpEncode val = RLPString $ BL.toStrict $ encode val

  rlpDecode (RLPString s) | B.null s = 0
  rlpDecode (RLPString s) | B.length s <= 16 = decode $ BL.fromStrict s
  rlpDecode x = error ("Missing case in rlp2Word128: " ++ show x)

instance RLPSerializable Word32 where
  rlpEncode val = RLPString $ BL.toStrict $ encode val

  rlpDecode (RLPString s) | B.null s = 0
  rlpDecode (RLPString s) | B.length s <= 4 = decode $ BL.fromStrict s
  rlpDecode x = error ("Missing case in rlp2Word32: " ++ show x)

instance RLPSerializable Word16 where
  rlpEncode val = RLPString $ BL.toStrict $ encode val

  rlpDecode (RLPString s) | B.null s = 0
  rlpDecode (RLPString s) | B.length s <= 2 = decode $ BL.fromStrict s
  rlpDecode x = error ("Missing case in rlp2Word16: " ++ show x)

instance Format Word256 where
  format x = BC.unpack $ B16.encode $ B.pack $ slowWord256ToBytes x

instance Ae.ToJSONKey Word256 where
  toJSONKey = Ae.ToJSONKeyText f (Enc.text . t)
    where
      f = DAK.fromText . T.pack . format
      t = T.pack . format

instance Ae.FromJSONKey Word256 where
  fromJSONKey = Ae.FromJSONKeyTextParser (Ae.parseJSON . Ae.String)

instance ToSchema Word160 where
  declareNamedSchema = const . pure $ named "Word160" binarySchema

-- add min max
