{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.SolidVM.Builtins where

import Blockchain.SolidVM.SM
import Blockchain.SolidVM.SetGet
import Blockchain.Strato.Model.Address (addressToByteString)
import Blockchain.VM.SolidException
import Control.Monad ((<=<))
import qualified Crypto.Hash.Poseidon as Poseidon
import Data.Bits (shiftL, shiftR, (.&.), (.|.))
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.Curve                   (Form(Weierstrass), Coordinates(Affine))
import Data.Curve.Weierstrass.BN254 (BN254, Fq, Fr, Point(..), add, mul)
import Data.Char (isDigit)
import Data.Foldable (fold)
import Data.List (isPrefixOf)
import Data.Pairing                 (pairing)
import Data.Pairing.BN254           (Fq2, G2', GT')
import qualified Data.Vector as V
import GHC.Exts (IsList(fromList))
import qualified SolidVM.Model.Storable as MS
import SolidVM.Model.Value

-- Pushes a new value to an array and returns the length of the new array
push :: MonadSM m => Value -> Maybe Variable -> ValList -> m Variable
push (SReference apt) _ [av] = do
  let lenPath = apt `apSnoc` MS.Field "length"
  len' <- getInt $ Constant $ SReference lenPath
  let len :: Int = fromIntegral len'
      newLen = SInteger $ fromIntegral $ len + 1
      idxPath = apt `apSnoc` MS.Index (BC.pack $ show len)
  setVar (Constant (SReference lenPath)) newLen
  setVar (Constant (SReference idxPath)) av
  return $ Constant newLen
push (SArray vec) (Just (Variable ref)) [av] = do
  newVar <- createVar av
  let newArr = V.snoc vec newVar
  setVar (Variable ref) (SArray newArr)
  return $ Constant (SInteger $ fromIntegral $ V.length newArr)
push v mv argVals = do
  invalidArguments "push" (v, mv, argVals)

modExp :: Integer -> Integer -> Integer -> Integer
modExp b e m =
  case (b, e, even e) of
    (0, _, _) -> 0
    (_, 0, _) -> 1
    (_, _, True) ->
      let y = modExp b (e `div` 2) m
        in (y * y) `mod` m
    (_, _, False) ->
      b * (modExp b (e - 1) m) `mod` m

point :: (Integer, Integer) -> Point Weierstrass Affine BN254 Fq Fr
point (x, y) =
  if x == 0 && y == 0
    then O
    else A (fromInteger x :: Fq) (fromInteger y :: Fq)

unpoint :: Point Weierstrass Affine BN254 Fq Fr -> (Integer, Integer)
unpoint (A x y) = (toInteger x, toInteger y)
unpoint O       = (0, 0)

ecAdd :: (Integer, Integer) -> (Integer, Integer) -> (Integer, Integer)
ecAdd p1 p2 = unpoint (add @Weierstrass @Affine @BN254 @Fq @Fr (point p1) (point p2))

ecMul :: (Integer, Integer) -> Integer -> (Integer, Integer)
ecMul p s = unpoint (mul @Weierstrass @Affine @BN254 (point p) (fromInteger s :: Fr))

ecPairing :: [Integer] -> Bool
ecPairing = maybe False doPairing . toTrios
  -- Ethereum orders the coordinates as x1, y1, x2Imag, x2Real, y2Imag, y2Real
  -- so toTrios regroups them to ((x1, y1), (x2Real, x2Imag), (y2Real, y2Imag)),
  -- which is the order in which pairing library (and poly library under the hood) expects
  where toTrios (a:b:c:d:e:f:g) = (((a,b),(d,c),(f,e)):) <$> toTrios g
        toTrios [] = Just []
        toTrios _ = Nothing
        doPairing trios =
          let toFq2 :: (Integer,Integer) -> Fq2
              toFq2 (u,v) = fromList [fromInteger u, fromInteger v]

              toG2 :: ((Integer,Integer), (Integer,Integer)) -> G2'
              toG2 (x2,y2) = A (toFq2 x2) (toFq2 y2)

              acc :: GT'
              acc = mconcat [pairing (point g1) (toG2 (x2,y2)) | (g1,x2,y2) <- trios]

           in acc == mempty

-- | Poseidon hash - ZK-friendly hash function over BN254 scalar field
-- Takes a list of integers (field elements) and returns their Poseidon hash
poseidonHash :: [Integer] -> Integer
poseidonHash inputs = Poseidon.fromF $ Poseidon.poseidon (map Poseidon.toF inputs)

--------------------------------------------------------------------------------
-- ABI Encoding / Decoding
--------------------------------------------------------------------------------

-- | Pad a ByteString on the left with zeros to 32 bytes.
padLeft32 :: B.ByteString -> B.ByteString
padLeft32 bs
  | B.length bs >= 32 = B.take 32 bs
  | otherwise = B.replicate (32 - B.length bs) 0 <> bs

-- | Pad a ByteString on the right with zeros to the next 32-byte boundary.
padRight32 :: B.ByteString -> B.ByteString
padRight32 bs
  | B.length bs `mod` 32 == 0 = bs
  | otherwise = bs <> B.replicate (32 - B.length bs `mod` 32) 0

-- | Encode an unsigned integer as a big-endian 32-byte word.
encodeUint256 :: Integer -> B.ByteString
encodeUint256 n = padLeft32 $ integerToBytesBE (n `mod` (2 ^ (256 :: Integer)))

-- | Encode a signed integer as a two's-complement big-endian 32-byte word.
encodeInt256 :: Integer -> B.ByteString
encodeInt256 n
  | n >= 0    = encodeUint256 n
  | otherwise = encodeUint256 (n + 2 ^ (256 :: Integer))

-- | Convert a non-negative Integer to big-endian bytes (no leading zeros).
integerToBytesBE :: Integer -> B.ByteString
integerToBytesBE 0 = B.singleton 0
integerToBytesBE n = B.pack $ go n []
  where
    go 0 acc = acc
    go x acc = go (x `shiftR` 8) (fromIntegral (x .&. 0xff) : acc)

-- | Convert big-endian bytes to a non-negative Integer.
bytesToIntegerBE :: B.ByteString -> Integer
bytesToIntegerBE = B.foldl' (\acc b -> acc `shiftL` 8 .|. fromIntegral b) 0

-- | Is a value dynamically-sized in ABI encoding?
isDynamicValue :: Value -> Bool
isDynamicValue (SBytes _)  = True
isDynamicValue (SString _) = True
isDynamicValue (SArray _)  = True
isDynamicValue _           = False

-- | ABI-encode a single static value to exactly 32 bytes.
encodeStaticValue :: Value -> B.ByteString
encodeStaticValue (SInteger n)       = encodeInt256 n
encodeStaticValue (SBool True)       = encodeUint256 1
encodeStaticValue (SBool False)      = encodeUint256 0
encodeStaticValue (SAddress addr _)  = padLeft32 $ addressToByteString addr
encodeStaticValue (SEnumVal _ _ w)   = encodeUint256 (fromIntegral w)
encodeStaticValue SNULL              = encodeUint256 0
encodeStaticValue _                  = encodeUint256 0

-- | ABI-encode a single dynamic value (length-prefixed, padded).
encodeDynamicValue :: MonadSM m => Value -> m B.ByteString
encodeDynamicValue (SBytes bs) = pure $
  encodeUint256 (fromIntegral $ B.length bs) <> padRight32 bs
encodeDynamicValue (SString s) = pure $
  let bs = BC.pack s
  in encodeUint256 (fromIntegral $ B.length bs) <> padRight32 bs
encodeDynamicValue (SArray vec) = do
  elems <- traverse weakGetVar (V.toList vec)
  encoded <- abiEncode elems
  pure $ encodeUint256 (fromIntegral $ length elems) <> encoded
encodeDynamicValue v = pure $ encodeStaticValue v

-- | Standard ABI encoding of a list of values.
-- Uses head/tail encoding: static values go directly in the head,
-- dynamic values get an offset pointer in the head and data in the tail.
abiEncode :: MonadSM m => [Value] -> m B.ByteString
abiEncode vals = do
  let n = length vals
      headSize = n * 32
      -- Build head and tail simultaneously
      go [] _ headAcc tailAcc = pure (headAcc, tailAcc)
      go (v:vs) tailOffset headAcc tailAcc
        | isDynamicValue v = do
            encoded <- encodeDynamicValue v
            let offsetWord = encodeUint256 (fromIntegral tailOffset)
            go vs (tailOffset + B.length encoded) (headAcc <> offsetWord) (tailAcc <> encoded)
        | otherwise =
            go vs tailOffset (headAcc <> encodeStaticValue v) tailAcc
  uncurry (<>) <$> go vals headSize B.empty B.empty

-- | Packed ABI encoding — no padding, no offsets.
abiEncodePacked :: MonadSM m => [Value] -> m B.ByteString
abiEncodePacked = fmap fold . traverse encodeValuePacked
  where
    encodeValuePacked :: MonadSM m => Value -> m B.ByteString
    encodeValuePacked (SBool True)       = pure $ B.singleton 1
    encodeValuePacked (SBool False)      = pure $ B.singleton 0
    encodeValuePacked (SAddress addr _)  = pure $ addressToByteString addr
    encodeValuePacked (SInteger n)       = pure $ encodeInt256 n
    encodeValuePacked (SString s)        = pure $ BC.pack s
    encodeValuePacked (SBytes bs)        = pure bs
    encodeValuePacked (SEnumVal _ _ w)   = pure $ encodeUint256 (fromIntegral w)
    encodeValuePacked (SArray vec)       = fold <$> traverse (encodeValuePacked <=< weakGetVar) vec
    encodeValuePacked SNULL              = pure B.empty
    encodeValuePacked _                  = pure B.empty

--------------------------------------------------------------------------------
-- ABI Decoding
--------------------------------------------------------------------------------

-- | Type descriptors for abi.decode
data TypeDescriptor
  = TUint Int        -- uint8..uint256
  | TInt Int         -- int8..int256
  | TBool
  | TAddress
  | TBytes           -- dynamic bytes
  | TString          -- dynamic string
  | TBytesN Int      -- bytes1..bytes32
  | TArrayOf TypeDescriptor  -- type[]
  deriving (Show)

isDynamicType :: TypeDescriptor -> Bool
isDynamicType TBytes        = True
isDynamicType TString       = True
isDynamicType (TArrayOf _)  = True
isDynamicType _             = False

-- | Parse a type descriptor string like "uint256", "address", "bytes32", "uint256[]"
parseTypeDescriptor :: String -> Maybe TypeDescriptor
parseTypeDescriptor s
  | "[]" `isSuffixOf` s =
      TArrayOf <$> parseTypeDescriptor (take (length s - 2) s)
  | s == "bool"    = Just TBool
  | s == "address" = Just TAddress
  | s == "bytes"   = Just TBytes
  | s == "string"  = Just TString
  | "uint" `isPrefixOf` s =
      let bits = drop 4 s
      in if null bits then Just (TUint 256)
         else if all isDigit bits then Just (TUint (read bits))
         else Nothing
  | "int" `isPrefixOf` s =
      let bits = drop 3 s
      in if null bits then Just (TInt 256)
         else if all isDigit bits then Just (TInt (read bits))
         else Nothing
  | "bytes" `isPrefixOf` s =
      let n = drop 5 s
      in if all isDigit n && not (null n) then Just (TBytesN (read n))
         else Nothing
  | otherwise = Nothing
  where
    isSuffixOf suffix str = drop (length str - length suffix) str == suffix

-- | Extract a type name string from a Value used as a type argument.
typeArgToString :: Value -> Maybe String
typeArgToString (SString s) = Just s
typeArgToString (SEnum s)   = Just s
typeArgToString _           = Nothing

-- | Decode a single value from ABI-encoded bytes starting at the given offset.
-- Returns the decoded value.
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
      addrBytes = B.drop 12 word  -- last 20 bytes
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
      elems = [ decodeValue elemType bs (elemsStart + i * 32) | i <- [0..len-1] ]
  in SArray (V.fromList $ map Constant elems)

-- | Decode ABI-encoded bytes given type arguments.
-- Type arguments are SString values like "uint256", "address", etc.
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
       vs  -> STuple (V.fromList $ map Constant vs)