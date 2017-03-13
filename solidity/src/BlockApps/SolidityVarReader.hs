{-# LANGUAGE
    LambdaCase
  , OverloadedStrings
  , RecordWildCards
#-}

module BlockApps.SolidityVarReader (
  decodeValue,
  word256ToByteString,
  byteStringToWord256,
  valueToSolidityValue
  ) where

import Data.Bits
import qualified Data.ByteArray as ByteArray
import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import qualified Data.ByteString.Char8 as BC
--import qualified Data.ByteString.Lazy as BL
import Data.LargeWord
import Data.List
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as Text
import Numeric.Natural
import Text.Printf

import BlockApps.Ethereum
import BlockApps.Solidity
import BlockApps.Storage (Storage)
import qualified BlockApps.Storage as Storage
import BlockApps.Types



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
  | ValueContract Address
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
valueToSolidityValue (ValueContract (Address addr)) =
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
  :: Storage
  -> Storage.Position
  -> Type
  -> Value
decodeValue storage position@Storage.Position{..} = \case
  TypeBool -> ValueBool $ storage offset /= 0
  TypeUInt (Just v) ->
    ValueUInt $ fromIntegral $ (.&. ((1 `shiftL` v) - 1)) $ (`shiftR` (byte*8)) $ storage offset
  TypeUInt Nothing -> decodeValue storage position (TypeUInt (Just 256))
  TypeInt (Just v) ->
     ValueInt $ fromIntegral $ (.&. ((1 `shiftL` v) - 1)) $ (`shiftR` (byte*8)) $ storage offset --TODO clean this up, deal with negatives

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

  TypeInt Nothing -> decodeValue storage position (TypeInt (Just 256))

  TypeAddress ->
    let
      ValueUInt addr = decodeValue storage position (TypeUInt (Just 160))
    in
      ValueAddress . Address $ fromIntegral addr
  TypeContract ->
    let
      ValueAddress addr = decodeValue storage position TypeAddress
    in
      ValueContract addr

{-
  TypeFixed (Just (n,m)) ->
    let
      ValueInt x = decodeValue storage offset (TypeInt (Just 256))
    in
      ValueFixed $ fromIntegral x / 2 ** fromIntegral n
  TypeFixed Nothing -> decodeValue storage offset (TypeFixed (Just (128,128)))
-}
  TypeBytes (Just n) -> ValueBytes $ ByteString.take n $ word256ToByteString $ storage offset

  TypeBytes Nothing | storage offset `testBit` 0 -> --large string, 32+ bytes
    let
      len = storage offset `div` 2
      startingKey=byteStringToWord256 $ ByteArray.convert $ unKeccak256 $ keccak256 $ word256ToByteString offset
    in ValueBytes $ ByteString.pack $ take (fromIntegral len) $ concatMap (ByteString.unpack . word256ToByteString . storage . (startingKey+)) [0..]

  TypeBytes Nothing -> --small string, less than 32 bytes
    let
      len = storage offset .&. 0xfe `div` 2
    in
      ValueBytes $ ByteString.take (fromIntegral len) $ word256ToByteString $ storage offset

  TypeString ->
    let
      ValueBytes bytes = decodeValue storage position (TypeBytes Nothing)
    in
      ValueString $ Text.decodeUtf8 bytes

  TypeFunction selector args returns -> ValueFunction selector args returns

  TypeArray _ (Just _) -> error "TypeArray Just n is undefined in decodeValue"

  TypeArray ty Nothing -> ValueArray $
    map (flip (decodeValue storage) ty . Storage.positionAt . (startingKey+)) [0..storage offset-1]
    where
      startingKey=byteStringToWord256 $ ByteArray.convert $ unKeccak256 $ keccak256 $ word256ToByteString offset

  TypeMapping tyk tyv -> ValueString $ T.pack $ "mapping (" ++ formatType tyk ++ " => " ++ formatType tyv ++ ")"
  x -> error $ "Missing case in decodeValue: " ++ show x
