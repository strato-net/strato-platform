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
import Data.Char (isDigit)
import Data.List (isPrefixOf)
import qualified Data.Vector as V
import SolidVM.Model.Value

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

typeArgToString :: Value -> Maybe String
typeArgToString (SString s) = Just s
typeArgToString (SEnum s) = Just s
typeArgToString _ = Nothing

--------------------------------------------------------------------------------
-- ABI decoding
--------------------------------------------------------------------------------

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
