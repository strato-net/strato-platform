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
    decodeValues,
    encodeValues,
    abiDecode,
  )
where

import Blockchain.Strato.Model.Address (addressToByteString)
import Data.Bits (shiftL, shiftR, (.&.), (.|.))
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.Char (isDigit)
import Data.List (elemIndices, isPrefixOf)
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
  | TFixedArray TypeDescriptor Int
  | TTuple [TypeDescriptor]
  deriving (Eq, Show)

isDynamicType :: TypeDescriptor -> Bool
isDynamicType TBytes = True
isDynamicType TString = True
isDynamicType (TArrayOf _) = True
isDynamicType (TFixedArray entry _) = isDynamicType entry
isDynamicType (TTuple entries) = any isDynamicType entries
isDynamicType _ = False

parseTypeDescriptor :: String -> Maybe TypeDescriptor
parseTypeDescriptor s
  | Just (base, arrayLength) <- splitArraySuffix s = do
      entry <- parseTypeDescriptor base
      case arrayLength of
        "" -> Just $ TArrayOf entry
        n | all isDigit n -> Just $ TFixedArray entry (read n)
        _ -> Nothing
  | Just inside <- tupleContents s =
      TTuple <$> traverse parseTypeDescriptor (splitTupleTypes inside)
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
    splitArraySuffix str
      | null str || last str /= ']' = Nothing
      | otherwise = case elemIndices '[' str of
          [] -> Nothing
          indices ->
            let i = last indices
             in Just (take i str, take (length str - i - 2) $ drop (i + 1) str)
    tupleContents ('(' : rest) = case reverse rest of
      ')' : reversedInside -> Just $ reverse reversedInside
      _ -> Nothing
    tupleContents _ = Nothing

-- | Split the members of a canonical tuple type without splitting nested
-- tuples. Empty tuples are valid in the grammar and decode to no members.
splitTupleTypes :: String -> [String]
splitTupleTypes "" = []
splitTupleTypes input = reverse $ finish $ go (0 :: Int) (0 :: Int) "" [] input
  where
    finish (current, result) = reverse current : result
    go _ _ current result [] = (current, result)
    go parenDepth arrayDepth current result (c : cs)
      | c == ',' && parenDepth == 0 && arrayDepth == 0 =
          go parenDepth arrayDepth "" (reverse current : result) cs
      | c == '(' = go (parenDepth + 1) arrayDepth (c : current) result cs
      | c == ')' = go (parenDepth - 1) arrayDepth (c : current) result cs
      | c == '[' = go parenDepth (arrayDepth + 1) (c : current) result cs
      | c == ']' = go parenDepth (arrayDepth - 1) (c : current) result cs
      | otherwise = go parenDepth arrayDepth (c : current) result cs

typeArgToString :: Value -> Maybe String
typeArgToString (SString s) = Just s
typeArgToString (SEnum s) = Just s
typeArgToString _ = Nothing

--------------------------------------------------------------------------------
-- ABI decoding
--------------------------------------------------------------------------------

decodeValue :: TypeDescriptor -> B.ByteString -> Int -> Value
decodeValue td bs offset = decodeAt td bs 0 offset

-- | Decode a complete ABI tuple. Unlike the old @i * 32@ traversal, the head
-- cursor advances over inline static tuples and fixed arrays by their full
-- width. Dynamic offsets are interpreted relative to the tuple that owns them.
decodeValues :: [TypeDescriptor] -> B.ByteString -> [Value]
decodeValues types bs = decodeSequence types bs 0 0

decodeSequence :: [TypeDescriptor] -> B.ByteString -> Int -> Int -> [Value]
decodeSequence types bs base start = snd $ foldl step (start, []) types
  where
    step (cursor, values) typ =
      let value = decodeAt typ bs base cursor
       in (cursor + headWidth typ, values ++ [value])

headWidth :: TypeDescriptor -> Int
headWidth typ
  | isDynamicType typ = 32
headWidth (TTuple entries) = sum $ map headWidth entries
headWidth (TFixedArray entry len) = len * headWidth entry
headWidth _ = 32

decodeAt :: TypeDescriptor -> B.ByteString -> Int -> Int -> Value
decodeAt typ bs base offset
  | isDynamicType typ =
      let relativeOffset = wordAt bs offset
       in decodeBody typ bs (base + relativeOffset)
decodeAt typ bs _ offset = decodeStatic typ bs offset

decodeStatic :: TypeDescriptor -> B.ByteString -> Int -> Value
decodeStatic (TUint _bits) bs offset =
  let word = B.take 32 (B.drop offset bs)
   in SInteger (bytesToIntegerBE word)
decodeStatic (TInt bits) bs offset =
  let word = B.take 32 (B.drop offset bs)
      raw = bytesToIntegerBE word
      maxPos = 2 ^ (bits - 1) - 1
   in if raw > maxPos
        then SInteger (raw - 2 ^ bits)
        else SInteger raw
decodeStatic TBool bs offset =
  let word = B.take 32 (B.drop offset bs)
   in SBool (bytesToIntegerBE word /= 0)
decodeStatic TAddress bs offset =
  let word = B.take 32 (B.drop offset bs)
      addrBytes = B.drop 12 word
      addrInt = bytesToIntegerBE addrBytes
   in SAddress (fromInteger addrInt) False
decodeStatic (TBytesN n) bs offset =
  let word = B.take 32 (B.drop offset bs)
   in SBytes (B.take n word)
decodeStatic (TTuple entries) bs offset =
  STuple . V.fromList . map Constant $ decodeSequence entries bs offset offset
decodeStatic (TFixedArray entry len) bs offset =
  SArray . V.fromList . map Constant $ decodeSequence (replicate len entry) bs offset offset
decodeStatic _ _ _ = SNULL

decodeBody :: TypeDescriptor -> B.ByteString -> Int -> Value
decodeBody TBytes bs dataOffset =
  let len = boundedLength bs (wordAt bs dataOffset) (dataOffset + 32)
   in SBytes (B.take len $ B.drop (dataOffset + 32) bs)
decodeBody TString bs dataOffset =
  let len = boundedLength bs (wordAt bs dataOffset) (dataOffset + 32)
   in SString (BC.unpack $ B.take len $ B.drop (dataOffset + 32) bs)
decodeBody (TArrayOf elemType) bs dataOffset =
  let elemsStart = dataOffset + 32
      maxElements = max 0 ((B.length bs - elemsStart) `div` max 1 (headWidth elemType))
      len = min maxElements (wordAt bs dataOffset)
      elems = decodeSequence (replicate len elemType) bs elemsStart elemsStart
   in SArray (V.fromList $ map Constant elems)
decodeBody (TFixedArray entry len) bs dataOffset =
  SArray . V.fromList . map Constant $ decodeSequence (replicate len entry) bs dataOffset dataOffset
decodeBody (TTuple entries) bs dataOffset =
  STuple . V.fromList . map Constant $ decodeSequence entries bs dataOffset dataOffset
decodeBody typ bs dataOffset = decodeStatic typ bs dataOffset

wordAt :: B.ByteString -> Int -> Int
wordAt bs offset
  | offset < 0 || offset + 32 > B.length bs = 0
  | otherwise = integerToBoundedInt $ bytesToIntegerBE (B.take 32 $ B.drop offset bs)

integerToBoundedInt :: Integer -> Int
integerToBoundedInt n
  | n <= 0 = 0
  | n > fromIntegral (maxBound :: Int) = maxBound
  | otherwise = fromIntegral n

boundedLength :: B.ByteString -> Int -> Int -> Int
boundedLength bs requested start = min requested (max 0 $ B.length bs - start)

--------------------------------------------------------------------------------
-- ABI encoding
--------------------------------------------------------------------------------

-- | Encode values as one ABI tuple. This is used for event data and provides
-- the inverse of 'decodeValues', including nested tuples and arrays.
encodeValues :: [TypeDescriptor] -> [Value] -> B.ByteString
encodeValues types values =
  let pairs = zip types values
      initialTailOffset = sum $ map (headWidth . fst) pairs
      step (headParts, tailParts, tailOffset) (typ, value)
        | isDynamicType typ =
            let body = encodeBody typ value
             in (headParts ++ [encodeUint256 $ fromIntegral tailOffset], tailParts ++ [body], tailOffset + B.length body)
        | otherwise = (headParts ++ [encodeStatic typ value], tailParts, tailOffset)
      (heads, tails, _) = foldl step ([], [], initialTailOffset) pairs
   in B.concat $ heads ++ tails

encodeStatic :: TypeDescriptor -> Value -> B.ByteString
encodeStatic (TUint _) (SInteger n) = encodeUint256 n
encodeStatic (TInt _) (SInteger n) = encodeInt256 n
encodeStatic TBool (SBool b) = encodeUint256 $ if b then 1 else 0
encodeStatic TAddress (SAddress addr _) = padLeft32 $ addressToByteString addr
encodeStatic (TBytesN n) (SBytes value) = B.take 32 $ B.take n value <> B.replicate 32 0
encodeStatic (TTuple types) (STuple values) = encodeValues types $ map getConst $ V.toList values
encodeStatic (TFixedArray entry len) (SArray values) =
  encodeValues (replicate len entry) $ map getConst $ take len $ V.toList values
encodeStatic _ SNULL = encodeUint256 0
encodeStatic _ _ = encodeUint256 0

encodeBody :: TypeDescriptor -> Value -> B.ByteString
encodeBody TBytes (SBytes value) = encodeUint256 (fromIntegral $ B.length value) <> padRight32 value
encodeBody TString (SString value) =
  let bytes = BC.pack value
   in encodeUint256 (fromIntegral $ B.length bytes) <> padRight32 bytes
encodeBody (TArrayOf entry) (SArray values) =
  let vals = map getConst $ V.toList values
   in encodeUint256 (fromIntegral $ length vals) <> encodeValues (replicate (length vals) entry) vals
encodeBody (TFixedArray entry len) (SArray values) =
  encodeValues (replicate len entry) $ map getConst $ take len $ V.toList values
encodeBody (TTuple types) (STuple values) = encodeValues types $ map getConst $ V.toList values
encodeBody _ _ = encodeUint256 0

abiDecode :: B.ByteString -> [Value] -> Value
abiDecode bs typeArgs =
  let typeStrs = map typeArgToString typeArgs
      typeDescs = map (>>= parseTypeDescriptor) typeStrs
      decoded = case sequence typeDescs of
        Just validTypes -> decodeValues validTypes bs
        Nothing -> replicate (length typeDescs) SNULL
   in case decoded of
        [v] -> v
        vs -> STuple (V.fromList $ map Constant vs)
