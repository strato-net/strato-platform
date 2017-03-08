{-# LANGUAGE
    LambdaCase
  , OverloadedStrings
#-}

module BlockApps.SolidityVarReader (
  Type(..),
  decodeValue,
  word256ToByteString,
  byteStringToWord256,
  valueToSolidityValue
  ) where

import Data.Bits
import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import qualified Data.ByteString.Char8 as BC
import Data.LargeWord
import Data.List
import Data.Text (Text)
import qualified Data.Text as T
import Numeric.Natural
import Text.Printf

import BlockApps.Ethereum
import BlockApps.Solidity

data Type
  = TypeBool
  | TypeUInt (Maybe Int)
  -- ^ uint<M>: unsigned integer type of M bits,
  -- 0 < M <= 256, M % 8 == 0. e.g. uint32, uint8, uint256.
  -- uint: synonyms for uint256
  | TypeInt (Maybe Int)
  -- ^ int<M>: integer type of M bits,
  -- 0 < M <= 256, M % 8 == 0. e.g. int32, int8, int256.
  -- int: synonyms for int256
  | TypeAddress
  | TypeFixed (Maybe (Int,Int))
  -- ^ fixed<M>x<N>: fixed-point signed number of M+N bits,
  -- 0 < M + N <= 256, M % 8 == N % 8 == 0.
  -- Corresponds to the int256 equivalent binary value divided by 2^N.
  -- fixed: synonyms for fixed128x128,
  -- (not to be used for computing the function selector).
  | TypeUFixed (Maybe (Int,Int))
  -- ^ ufixed<M>x<N>: unsigned variant of fixed<M>x<N>.
  -- ufixed: synonyms for ufixed128x128
  -- (not to be used for computing the function selector).
  | TypeBytes (Maybe Int)
  -- ^ bytes<M>: binary type of M bytes, 0 < M <= 32.
  -- bytes: dynamic sized byte sequence.
  | TypeString
  -- ^ string: dynamic sized unicode string assumed to be UTF-8 encoded.
  | TypeFunction ByteString [(Text, Type)] [(Maybe Text, Type)]
  -- ^ function: equivalent to bytes24: an address,
  -- followed by a function selector
  | TypeArray Type (Maybe Int)
  -- ^ <type>[M]: a fixed-length array of the given fixed-length type.
  -- <type>[]: a variable-length array of the given fixed-length type.
  | TypeMapping Type Type
  | TypeContract Text
  deriving (Eq, Show)

formatType::Type->String
formatType TypeAddress = "Address"
formatType (TypeInt Nothing) = "Int"
formatType (TypeUInt Nothing) = "UInt"
formatType x = show x

data Value
  = ValueBool Bool
  | ValueUInt Natural
  | ValueInt Integer
  | ValueAddress Address
  | ValueFixed Double
  | ValueUFixed Double
  | ValueBytes ByteString
  | ValueArray [Value]
  | ValueString Text
  | ValueFunction ByteString [(Text, Type)] [(Maybe Text, Type)]
  deriving (Eq,Show)

valueToSolidityValue::Value->SolidityValue
valueToSolidityValue (ValueBool x) = SolidityBool x
valueToSolidityValue (ValueInt v) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (ValueUInt v) = SolidityValueAsString $ T.pack $ show v
valueToSolidityValue (ValueString s) = SolidityValueAsString s
valueToSolidityValue (ValueAddress (Address addr)) =
  SolidityValueAsString $ T.pack $ printf "%040x" (fromIntegral addr::Integer)
valueToSolidityValue (ValueArray values) = SolidityArray $ map valueToSolidityValue values
valueToSolidityValue (ValueBytes bytes) = SolidityValueAsString $ T.pack $ BC.unpack bytes
valueToSolidityValue (ValueFunction _ paramTypes returnTypes) =
  SolidityValueAsString $ T.pack $ "function ("
                          ++ intercalate "," (map (formatType . snd) paramTypes)
                          ++ ") returns ("
                          ++ intercalate "," (map (formatType . snd) returnTypes)
                          ++ ")"
valueToSolidityValue x = error $ "missing value in valueToSolidityValue: " ++ show x


word256ToByteString::Word256->ByteString
word256ToByteString x= ByteString.pack $ map (fromIntegral . (x `shiftR`) . (*8)) [31, 30..0]


byteStringToWord256::ByteString->Word256
byteStringToWord256 x = sum $ map (\(shiftBits, v) -> v `shiftL` (shiftBits*8)) $ zip [31,30..0] $ map fromIntegral $ ByteString.unpack x



decodeValue
  ::(Word256->Word256)
--  :: ByteString
  -> Word256
  -> Type
  -> Value
decodeValue storage offset = \case
  TypeBool -> ValueBool $ storage offset /= 0
  TypeUInt (Just _) -> ValueUInt $ fromIntegral $ storage offset --TODO check for error where value too high for type
  TypeUInt Nothing -> decodeValue storage offset (TypeUInt (Just 256))
  TypeInt (Just _) -> ValueInt $ fromIntegral $ storage offset --TODO clean this up, deal with negatives
{-    let
      Just (byte,bytes) = ByteString.uncons $ slice n
      (sign, significant) =
        if byte == 0xff
          then (negate, ByteString.dropWhile (==0xff) bytes)
          else (id, ByteString.dropWhile (==0x00) bytes)
      m = ByteString.length significant
      significant' = map fromIntegral $ ByteString.unpack significant
    in
      ValueInt . sign . sum $
        zipWith shiftL significant' [8*(m-1),8*(m-2)..0]
-}
{-
  TypeInt Nothing -> decodeValue storage offset (TypeInt (Just 256))
-}
  TypeAddress ->
    let
      ValueUInt addr = decodeValue storage offset (TypeUInt (Just 160))
    in
      ValueAddress . Address $ fromIntegral addr
{-
  TypeFixed (Just (n,m)) ->
    let
      ValueInt x = decodeValue storage offset (TypeInt (Just 256))
    in
      ValueFixed $ fromIntegral x / 2 ** fromIntegral n
  TypeFixed Nothing -> decodeValue storage offset (TypeFixed (Just (128,128)))
-}
  TypeBytes (Just 32) -> ValueBytes $ word256ToByteString $ storage offset
  TypeBytes (Just _) -> error "decodeValue not implemented for TypeBytes (Just n)"
{-
  TypeBytes Nothing ->
    let
      ValueUInt len = decodeValue storage offset (TypeUInt (Just 256))
      padding = len `mod` 32
    in
      ValueBytes . ByteString.take (fromIntegral (padding + len)) $
        ByteString.drop offset storage
  TypeString ->
    let
      ValueBytes bytes = decodeValue storage offset (TypeBytes Nothing)
    in
      ValueString $ Text.decodeUtf8 bytes
-}
  TypeFunction selector args returns -> ValueFunction selector args returns

  TypeArray _ (Just _) -> error "TypeArray Just n is undefined in decodeValue"

  TypeArray ty Nothing -> ValueArray $ map (flip (decodeValue storage) ty) $ map (startingKey+) [0..storage offset-1]
    where
      startingKey=byteStringToWord256 $ keccak256ByteString $ keccak256 $ word256ToByteString offset

  TypeMapping tyk tyv -> ValueString $ T.pack $ "mapping (" ++ formatType tyk ++ " => " ++ formatType tyv ++ ")"
  x -> error $ "Missing case in decodeValue: " ++ show x
