{-# LANGUAGE OverloadedStrings #-}

module SolidVM.Model.ABI where

import Data.Bits (shiftL, shiftR, (.&.), (.|.))
import qualified Data.ByteString as B
import qualified Data.ByteString.Internal as BI
import Data.Char (isDigit)
import Data.List (isPrefixOf)
import Data.Word (byteSwap64)
import Foreign.Storable (pokeByteOff)

--------------------------------------------------------------------------------
-- Byte-level primitives
--------------------------------------------------------------------------------

padLeft32 :: B.ByteString -> B.ByteString
padLeft32 bs
  | B.length bs >= 32 = B.take 32 bs
  | otherwise = B.replicate (32 - B.length bs) 0 <> bs

padRight32 :: B.ByteString -> B.ByteString
padRight32 bs
  | B.length bs `mod` 32 == 0 = bs
  | otherwise = bs <> B.replicate (32 - B.length bs `mod` 32) 0

encodeUint256 :: Integer -> B.ByteString
encodeUint256 n = BI.unsafeCreate 32 $ \p -> go p (3 :: Int) (n `mod` (2 ^ (256 :: Integer)))
  where
    -- 32 bytes big-endian, written as four Word64s from the low end
    go p i m = do
      pokeByteOff p (i * 8) (byteSwap64 (fromIntegral m))
      if i == 0 then pure () else go p (i - 1) (m `shiftR` 64)

encodeInt256 :: Integer -> B.ByteString
encodeInt256 n
  | n >= 0 = encodeUint256 n
  | otherwise = encodeUint256 (n + 2 ^ (256 :: Integer))

integerToBytesBE :: Integer -> B.ByteString
integerToBytesBE 0 = B.singleton 0
integerToBytesBE n = B.pack $ go n []
  where
    go 0 acc = acc
    go x acc = go (x `shiftR` 8) (fromIntegral (x .&. 0xff) : acc)

bytesToIntegerBE :: B.ByteString -> Integer
bytesToIntegerBE = B.foldl' (\acc b -> acc `shiftL` 8 .|. fromIntegral b) 0

--------------------------------------------------------------------------------
-- Type descriptors
--------------------------------------------------------------------------------

data TypeDescriptor
  = TUint Int
  | TInt Int
  | TBool
  | TAddress
  | TBytes
  | TString
  | TBytesN Int
  | TArrayOf TypeDescriptor
  deriving (Show)

isDynamicType :: TypeDescriptor -> Bool
isDynamicType TBytes = True
isDynamicType TString = True
isDynamicType (TArrayOf _) = True
isDynamicType _ = False

parseTypeDescriptor :: String -> Maybe TypeDescriptor
parseTypeDescriptor s
  | "[]" `isSuffixOf` s =
      TArrayOf <$> parseTypeDescriptor (take (length s - 2) s)
  | s == "bool" = Just TBool
  | s == "address" = Just TAddress
  | s == "bytes" = Just TBytes
  | s == "string" = Just TString
  | "uint" `isPrefixOf` s =
      let bits = drop 4 s
       in if null bits
            then Just (TUint 256)
            else if all isDigit bits then Just (TUint (read bits)) else Nothing
  | "int" `isPrefixOf` s =
      let bits = drop 3 s
       in if null bits
            then Just (TInt 256)
            else if all isDigit bits then Just (TInt (read bits)) else Nothing
  | "bytes" `isPrefixOf` s =
      let n = drop 5 s
       in if all isDigit n && not (null n) then Just (TBytesN (read n)) else Nothing
  | otherwise = Nothing
  where
    isSuffixOf suffix str = drop (length str - length suffix) str == suffix

abiEncode :: [(Bool, B.ByteString)] -> B.ByteString
abiEncode vals =
  let headSize = length vals * 32
      go [] _ headAcc tailAcc = headAcc <> tailAcc
      go ((dynamic, encoded):vs) tailOffset headAcc tailAcc
        | dynamic =
            let offsetWord = encodeUint256 (fromIntegral tailOffset)
            in go vs (tailOffset + B.length encoded) (headAcc <> offsetWord) (tailAcc <> encoded)
        | otherwise = go vs tailOffset (headAcc <> encoded) tailAcc
  in go vals headSize B.empty B.empty

abiEncodePacked :: [B.ByteString] -> B.ByteString
abiEncodePacked = mconcat

encodeDynamicBytes :: B.ByteString -> B.ByteString
encodeDynamicBytes bs = encodeUint256 (fromIntegral $ B.length bs) <> padRight32 bs

encodeDynamicArray :: Int -> B.ByteString -> B.ByteString
encodeDynamicArray count encoded = encodeUint256 (fromIntegral count) <> encoded

decodeUint :: B.ByteString -> Int -> Integer
decodeUint bs offset = bytesToIntegerBE (B.take 32 (B.drop offset bs))

decodeInt :: Int -> B.ByteString -> Int -> Integer
decodeInt bits bs offset =
  let raw = decodeUint bs offset
      maxPos = 2 ^ (bits - 1) - 1
  in if raw > maxPos then raw - 2 ^ bits else raw

decodeAddress :: B.ByteString -> Int -> Integer
decodeAddress bs offset = bytesToIntegerBE $ B.drop 12 $ B.take 32 (B.drop offset bs)

decodeFixedBytes :: Int -> B.ByteString -> Int -> B.ByteString
decodeFixedBytes n bs offset = B.take n $ B.take 32 (B.drop offset bs)

decodeBytes :: B.ByteString -> Int -> B.ByteString
decodeBytes bs offset =
  let dataOffset = fromIntegral (decodeUint bs offset)
      len = fromIntegral (decodeUint bs dataOffset)
  in B.take len (B.drop (dataOffset + 32) bs)

decodeArray :: (B.ByteString -> Int -> a) -> B.ByteString -> Int -> [a]
decodeArray decodeElement bs offset =
  let total = B.length bs
      dataOffsetI = decodeUint bs offset
      dataOffset = fromIntegral dataOffsetI :: Int
      -- A length word that points outside the calldata is malformed.
      rawLen
        | dataOffsetI < 0 || dataOffsetI > fromIntegral total = 0
        | otherwise = decodeUint bs dataOffset
      elemsStart = dataOffset + 32
      -- Clamp the declared length to the number of 32-byte element slots that
      -- actually remain. Without this, a crafted length (e.g. a misaligned
      -- offset yielding ~2^34) makes V.fromList allocate an enormous vector and
      -- crashes the node, since eth_call ABI decoding runs before gas metering.
      maxElems = max 0 ((total - elemsStart) `div` 32)
      len = fromIntegral (min rawLen (fromIntegral maxElems)) :: Int
  in [decodeElement bs (elemsStart + i * 32) | i <- [0 .. len - 1]]

abiDecode :: (TypeDescriptor -> B.ByteString -> Int -> a) -> a -> B.ByteString -> [Maybe String] -> [a]
abiDecode decodeValue nullValue bs typeStrs =
  let typeDescs = map (>>= parseTypeDescriptor) typeStrs
      go [] _ = []
      go (Just td : tds) headOffset =
        decodeValue td bs headOffset : go tds (headOffset + 32)
      go (Nothing : tds) headOffset =
        nullValue : go tds (headOffset + 32)
  in go typeDescs 0
