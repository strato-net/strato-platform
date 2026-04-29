{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.ABI.Codec
  ( -- * Type descriptors
    TypeDescriptor (..),
    parseTypeDescriptor,
    parseTypeDescriptorStrict,
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
    decodeValueStrict,
    abiDecode,
    abiDecodeGated,
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
  deriving (Eq, Show)

isDynamicType :: TypeDescriptor -> Bool
isDynamicType TBytes = True
isDynamicType TString = True
isDynamicType (TArrayOf _) = True
isDynamicType _ = False

-- | Parse a Solidity ABI type descriptor string. NOTE: audit finding 6
-- calls for rejecting numerically invalid widths (e.g. @int0@,
-- @uint1000@). Rejecting them here changes which contracts decode
-- successfully across existing chain state and must be fork-gated.
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
            else TUint <$> readMaybe bits
  | "int" `isPrefixOf` s =
      let bits = drop 3 s
       in if null bits
            then Just (TInt 256)
            else TInt <$> readMaybe bits
  | "bytes" `isPrefixOf` s =
      let n = drop 5 s
       in if null n then Nothing else TBytesN <$> readMaybe n
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

-- | Decode a single ABI value.
--
-- NOTE: audit findings 6, 12, 13, 28, and 35 call for rejecting
-- out-of-bounds offsets, capping decoded array lengths, masking narrow
-- integer types to their declared width, and rejecting invalid widths.
-- All of those change the decoded value for malformed (but
-- previously-accepted) inputs and would fork chain state on replay.
-- Keep the legacy silent-zero / truncate behaviour here and revisit
-- behind a fork block.
decodeValue :: TypeDescriptor -> B.ByteString -> Int -> Value
decodeValue (TUint _bits) bs offset =
  let word = B.take 32 (B.drop offset bs)
   in SInteger (bytesToIntegerBE word)
decodeValue (TInt bits) bs offset =
  let word = B.take 32 (B.drop offset bs)
      raw = bytesToIntegerBE word
      maxPos = 2 ^ (bits - 1) - 1
   in if raw > maxPos
        then SInteger (raw - 2 ^ bits)
        else SInteger raw
decodeValue TBool bs offset =
  let word = B.take 32 (B.drop offset bs)
   in SBool (bytesToIntegerBE word /= 0)
decodeValue TAddress bs offset =
  let word = B.take 32 (B.drop offset bs)
      addrBytes = B.drop 12 word
      addrInt = bytesToIntegerBE addrBytes
   in SAddress (fromInteger addrInt) False
decodeValue (TBytesN n) bs offset =
  let word = B.take 32 (B.drop offset bs)
   in SBytes (B.take n word)
decodeValue TBytes bs offset =
  let dataOffset = fromIntegral (bytesToIntegerBE (B.take 32 (B.drop offset bs)))
      len = fromIntegral (bytesToIntegerBE (B.take 32 (B.drop dataOffset bs)))
   in SBytes (B.take len (B.drop (dataOffset + 32) bs))
decodeValue TString bs offset =
  let dataOffset = fromIntegral (bytesToIntegerBE (B.take 32 (B.drop offset bs)))
      len = fromIntegral (bytesToIntegerBE (B.take 32 (B.drop dataOffset bs)))
   in SString (BC.unpack (B.take len (B.drop (dataOffset + 32) bs)))
decodeValue (TArrayOf elemType) bs offset =
  let dataOffset = fromIntegral (bytesToIntegerBE (B.take 32 (B.drop offset bs)))
      len = fromIntegral (bytesToIntegerBE (B.take 32 (B.drop dataOffset bs))) :: Int
      elemsStart = dataOffset + 32
      elems = [decodeValue elemType bs (elemsStart + i * 32) | i <- [0 .. len - 1]]
   in SArray (V.fromList $ map Constant elems)

abiDecode :: B.ByteString -> [Value] -> Value
abiDecode = abiDecodeGated False

-- | Audit findings 6, 12, 13, 28, 35: gated variant of 'abiDecode'. Pass
-- 'True' to apply the post-audit strict semantics (bounds checks, mask
-- narrow ints, reject invalid widths, cap array lengths). Pass 'False'
-- to preserve pre-audit behaviour.
abiDecodeGated :: Bool -> B.ByteString -> [Value] -> Value
abiDecodeGated strict bs typeArgs =
  let parseTD = if strict then parseTypeDescriptorStrict else parseTypeDescriptor
      decode = if strict then decodeValueStrict else decodeValue
      typeStrs = map typeArgToString typeArgs
      typeDescs = map (>>= parseTD) typeStrs
      go [] _ = []
      go (Just td : tds) headOffset =
        decode td bs headOffset : go tds (headOffset + 32)
      go (Nothing : tds) headOffset =
        SNULL : go tds (headOffset + 32)
      decoded = go typeDescs 0
   in case decoded of
        [v] -> v
        vs -> STuple (V.fromList $ map Constant vs)

-- | Post-audit: reject numerically invalid widths (e.g. @uint0@, @int1000@,
-- @bytes33@) at type-descriptor parse time.
parseTypeDescriptorStrict :: String -> Maybe TypeDescriptor
parseTypeDescriptorStrict s
  | "[]" `isSuffixOf` s =
      TArrayOf <$> parseTypeDescriptorStrict (take (length s - 2) s)
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
              if validIntBits b then Just (TUint b) else Nothing
  | "int" `isPrefixOf` s =
      let bits = drop 3 s
       in if null bits
            then Just (TInt 256)
            else do
              b <- readMaybe bits
              if validIntBits b then Just (TInt b) else Nothing
  | "bytes" `isPrefixOf` s = do
      let n = drop 5 s
      w <- readMaybe n
      if w >= 1 && w <= 32 then Just (TBytesN w) else Nothing
  | otherwise = Nothing
  where
    isSuffixOf suffix str = drop (length str - length suffix) str == suffix
    validIntBits b = b >= 8 && b <= 256 && b `mod` 8 == 0

-- | Maximum elements for a decoded dynamic array / bytes field
-- (post-audit). Prevents OOM on a hostile length prefix.
maxAbiDecodeElements :: Int
maxAbiDecodeElements = 1024 * 1024

-- | Post-audit 'decodeValue': masks narrow integer results to the
-- declared bit width, uses two's-complement over that width for signed
-- types, and rejects out-of-bounds offsets / oversized lengths rather
-- than silently producing zero-padded junk.
decodeValueStrict :: TypeDescriptor -> B.ByteString -> Int -> Value
decodeValueStrict (TUint bits) bs offset =
  case readWord bs offset of
    Nothing -> SNULL
    Just word ->
      let raw = bytesToIntegerBE word
          mask = (2 ^ (bits :: Int)) - 1
       in SInteger (raw .&. mask)
decodeValueStrict (TInt bits) bs offset =
  case readWord bs offset of
    Nothing -> SNULL
    Just word ->
      let raw = bytesToIntegerBE word
          mask = (2 ^ (bits :: Int)) - 1
          masked = raw .&. mask
          signBit = 2 ^ (bits - 1)
       in if masked >= signBit
            then SInteger (masked - 2 ^ (bits :: Int))
            else SInteger masked
decodeValueStrict TBool bs offset =
  case readWord bs offset of
    Nothing -> SNULL
    Just word -> SBool (bytesToIntegerBE word /= 0)
decodeValueStrict TAddress bs offset =
  case readWord bs offset of
    Nothing -> SNULL
    Just word ->
      let addrBytes = B.drop 12 word
          addrInt = bytesToIntegerBE addrBytes
       in SAddress (fromInteger addrInt) False
decodeValueStrict (TBytesN n) bs offset =
  case readWord bs offset of
    Nothing -> SNULL
    Just word -> SBytes (B.take n word)
decodeValueStrict TBytes bs offset =
  case decodeDynamicBytes bs offset of
    Nothing -> SNULL
    Just payload -> SBytes payload
decodeValueStrict TString bs offset =
  case decodeDynamicBytes bs offset of
    Nothing -> SNULL
    Just payload -> SString (BC.unpack payload)
decodeValueStrict (TArrayOf elemType) bs offset =
  case readWord bs offset of
    Nothing -> SNULL
    Just offW ->
      let dataOffset = fromIntegral (bytesToIntegerBE offW) :: Int
       in case readWord bs dataOffset of
            Nothing -> SNULL
            Just lenW ->
              let lenInt = bytesToIntegerBE lenW
                  remainingBytes = B.length bs - (dataOffset + 32)
                  maxByLen = remainingBytes `div` 32
                  cap = fromIntegral (min (toInteger maxAbiDecodeElements) (toInteger maxByLen))
                  len = if lenInt < 0 then 0
                        else if lenInt > toInteger cap then cap
                        else fromIntegral lenInt :: Int
                  elemsStart = dataOffset + 32
                  elems = [decodeValueStrict elemType bs (elemsStart + i * 32) | i <- [0 .. len - 1]]
               in SArray (V.fromList $ map Constant elems)

readWord :: B.ByteString -> Int -> Maybe B.ByteString
readWord bs offset
  | offset < 0 = Nothing
  | offset + 32 > B.length bs = Nothing
  | otherwise = Just (B.take 32 (B.drop offset bs))

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
