{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.ABI.Codec
  ( -- * Type descriptors
    TypeDescriptor (..),
    parseTypeDescriptor,
    isDynamicType,
    typeArgToString,

    -- * Byte-level primitives
    padLeft32,
    padRight32,
    encodeUint256,
    encodeInt256,
    integerToBytesBE,
    bytesToIntegerBE,

    -- * Value-level encode / decode
    encodeStaticValue,
    isDynamicValue,
    decodeValue,
    abiDecode,
  )
where

import Blockchain.Strato.Model.Address (addressToByteString)
import Data.Bits (shiftL, shiftR, (.&.), (.|.))
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.List (isPrefixOf)
import qualified Data.Vector as V
import SolidVM.Model.Value
import Text.Read (readMaybe)

-- | Upper bound on the number of elements allowed in a decoded dynamic
-- array or bytes field. Prevents a malicious ABI payload from forcing
-- the decoder to allocate tens of gigabytes via a list comprehension.
maxAbiDecodeElements :: Int
maxAbiDecodeElements = 1024 * 1024 -- 1M elements

-- | Valid Solidity intN/uintN widths must be a multiple of 8 in [8, 256].
isValidIntBits :: Int -> Bool
isValidIntBits b = b >= 8 && b <= 256 && b `mod` 8 == 0

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
encodeUint256 n = padLeft32 $ integerToBytesBE (n `mod` (2 ^ (256 :: Integer)))

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
-- Value-level encoding helpers (pure, used by solid-vm's monadic abiEncode)
--------------------------------------------------------------------------------

isDynamicValue :: Value -> Bool
isDynamicValue (SBytes _) = True
isDynamicValue (SString _) = True
isDynamicValue (SArray _) = True
isDynamicValue _ = False

encodeStaticValue :: Value -> B.ByteString
encodeStaticValue (SInteger n) = encodeInt256 n
encodeStaticValue (SBool True) = encodeUint256 1
encodeStaticValue (SBool False) = encodeUint256 0
encodeStaticValue (SAddress addr _) = padLeft32 $ addressToByteString addr
encodeStaticValue (SEnumVal _ _ w) = encodeUint256 (fromIntegral w)
encodeStaticValue SNULL = encodeUint256 0
encodeStaticValue _ = encodeUint256 0

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

-- | Parse a Solidity ABI type descriptor string. Returns 'Nothing' for
-- syntactically invalid inputs *and* for numerically invalid widths (e.g.
-- @int0@, @uint1000@, @bytes33@). Previously any digit sequence was
-- accepted, which produced crashing types like @TInt 0@ (negative exponent
-- in 2^(-1)) and DoS-prone types like @TInt 10000000@.
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
            else do
              b <- readMaybe bits
              if isValidIntBits b then Just (TUint b) else Nothing
  | "int" `isPrefixOf` s =
      let bits = drop 3 s
       in if null bits
            then Just (TInt 256)
            else do
              b <- readMaybe bits
              if isValidIntBits b then Just (TInt b) else Nothing
  | "bytes" `isPrefixOf` s = do
      let n = drop 5 s
      w <- readMaybe n
      if w >= 1 && w <= 32 then Just (TBytesN w) else Nothing
  | otherwise = Nothing
  where
    isSuffixOf suffix str = drop (length str - length suffix) str == suffix

typeArgToString :: Value -> Maybe String
typeArgToString (SString s) = Just s
typeArgToString (SEnum s) = Just s
typeArgToString _ = Nothing

--------------------------------------------------------------------------------
-- ABI decoding
--------------------------------------------------------------------------------

-- | Read a 32-byte word at @offset@ from @bs@. Returns @Nothing@ when the
-- buffer is too short (previously this silently produced a zero word via
-- 'B.take'/'B.drop' truncation, letting attackers force 'address(0)' /
-- 'false' in downstream decodes).
readWord :: B.ByteString -> Int -> Maybe B.ByteString
readWord bs offset
  | offset < 0 = Nothing
  | offset + 32 > B.length bs = Nothing
  | otherwise = Just (B.take 32 (B.drop offset bs))

-- | Decode a single ABI value. Out-of-bounds reads and obviously hostile
-- dynamic sizes return 'SNULL' rather than silently fabricating zeros.
decodeValue :: TypeDescriptor -> B.ByteString -> Int -> Value
decodeValue (TUint bits) bs offset =
  case readWord bs offset of
    Nothing -> SNULL
    Just word ->
      let raw = bytesToIntegerBE word
          mask = (2 ^ (bits :: Int)) - 1
       in SInteger (raw .&. mask)
decodeValue (TInt bits) bs offset =
  case readWord bs offset of
    Nothing -> SNULL
    Just word ->
      -- Mask to declared bit width, then interpret as two's complement over
      -- that same width. The previous formula subtracted 2^bits from the
      -- full 256-bit raw value, which produced nonsense for bits < 256.
      let raw = bytesToIntegerBE word
          mask = (2 ^ (bits :: Int)) - 1
          masked = raw .&. mask
          signBit = 2 ^ (bits - 1)
       in if masked >= signBit
            then SInteger (masked - 2 ^ (bits :: Int))
            else SInteger masked
decodeValue TBool bs offset =
  case readWord bs offset of
    Nothing -> SNULL
    Just word -> SBool (bytesToIntegerBE word /= 0)
decodeValue TAddress bs offset =
  case readWord bs offset of
    Nothing -> SNULL
    Just word ->
      let addrBytes = B.drop 12 word
          addrInt = bytesToIntegerBE addrBytes
       in SAddress (fromInteger addrInt) False
decodeValue (TBytesN n) bs offset =
  case readWord bs offset of
    Nothing -> SNULL
    Just word -> SBytes (B.take n word)
decodeValue TBytes bs offset =
  case decodeDynamicBytes bs offset of
    Nothing -> SNULL
    Just payload -> SBytes payload
decodeValue TString bs offset =
  case decodeDynamicBytes bs offset of
    Nothing -> SNULL
    Just payload -> SString (BC.unpack payload)
decodeValue (TArrayOf elemType) bs offset =
  case readWord bs offset of
    Nothing -> SNULL
    Just offW ->
      let dataOffset = fromIntegral (bytesToIntegerBE offW) :: Int
       in case readWord bs dataOffset of
            Nothing -> SNULL
            Just lenW ->
              let lenInt = bytesToIntegerBE lenW
                  remainingBytes = B.length bs - (dataOffset + 32)
                  -- Cap the decoded length at both a hard ceiling and the
                  -- actual remaining buffer size to prevent OOM.
                  maxByLen = remainingBytes `div` 32
                  cap = fromIntegral (min (toInteger maxAbiDecodeElements) (toInteger maxByLen))
                  len = if lenInt < 0 then 0
                        else if lenInt > toInteger cap then cap
                        else fromIntegral lenInt :: Int
                  elemsStart = dataOffset + 32
                  elems = [decodeValue elemType bs (elemsStart + i * 32) | i <- [0 .. len - 1]]
               in SArray (V.fromList $ map Constant elems)

-- | Shared dynamic-bytes reader used by TBytes and TString. Validates both
-- the outer offset word and the payload bounds.
decodeDynamicBytes :: B.ByteString -> Int -> Maybe B.ByteString
decodeDynamicBytes bs offset = do
  offW <- readWord bs offset
  let dataOffset = fromIntegral (bytesToIntegerBE offW) :: Int
  lenW <- readWord bs dataOffset
  let lenInt = bytesToIntegerBE lenW
      payloadStart = dataOffset + 32
      remaining = B.length bs - payloadStart
      cap = min (toInteger maxAbiDecodeElements) (toInteger remaining)
      len = if lenInt < 0 || lenInt > cap
              then fromIntegral (max 0 cap)
              else fromIntegral lenInt
  if payloadStart < 0 || payloadStart > B.length bs
    then Nothing
    else Just (B.take len (B.drop payloadStart bs))

abiDecode :: B.ByteString -> [Value] -> Value
abiDecode bs typeArgs =
  let typeStrs = map typeArgToString typeArgs
      typeDescs = map (>>= parseTypeDescriptor) typeStrs
      go [] _ = []
      go (Just td : tds) headOffset =
        decodeValue td bs headOffset : go tds (headOffset + 32)
      go (Nothing : tds) headOffset =
        SNULL : go tds (headOffset + 32)
      decoded = go typeDescs 0
   in case decoded of
        [v] -> v
        vs -> STuple (V.fromList $ map Constant vs)
