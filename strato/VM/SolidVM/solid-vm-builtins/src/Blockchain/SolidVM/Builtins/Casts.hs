{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeSynonymInstances #-}

module Blockchain.SolidVM.Builtins.Casts
  ( int,
    decimal,
    address,
    string,
    bool,
    bytes,
    SolidInt,
    SolidDecimal,
    SolidAddress,
    SolidString,
    SolidBool,
    SolidBytes,
    CastError,
    CastResult,
  ) where

import Blockchain.Data.Util (integer2Bytes)
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Util (byteString2Integer)
import Control.Monad.Except (MonadError, throwError)
import Data.Bits ((.&.))
import qualified Data.Bool as Bool
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Decimal
import Data.Maybe (fromMaybe)
import qualified Data.Text as T
import qualified Data.Text.Encoding as DT
import qualified Numeric (showHex)
import Text.Printf (printf)
import Text.Read (readEither, readMaybe)

parseBaseInt :: String -> Integer -> Either String Integer
parseBaseInt s n =
  case n of
    10 -> readEither s
    16 ->
      let s' = case s of
                 '0':'x':rest -> rest
                 _ -> s
          prefix' = Bool.bool "0" "" . even $ length s'
       in case B16.decode (BC.pack $ prefix' ++ s') of
            Right l -> Right $ byteString2Integer l
            _ -> Left $ "numeric cast - not a hex string " <> s
    _ -> Left $ "Cannot convert string " <> s <> " to base " <> show n

type CastError = (String, [T.Text])
type CastResult a = Either CastError a

int :: (SolidInt a, MonadError CastError m) => a -> m Integer
int = castResult . castInt

decimal :: (SolidDecimal a, MonadError CastError m) => a -> m Decimal
decimal = castResult . castDecimal

address :: (SolidAddress a, MonadError CastError m) => a -> m Address
address = castResult . castAddress

string :: (SolidString a, MonadError CastError m) => a -> m T.Text
string = castResult . castString

bool :: (SolidBool a, MonadError CastError m) => a -> m Bool
bool = castResult . castBool

bytes :: (SolidBytes a, MonadError CastError m) => a -> m B.ByteString
bytes = castResult . castBytes

class SolidBool a where
  castBool :: a -> CastResult Bool

instance SolidBool Bool where
  castBool = Right

instance SolidBool String where
  castBool value = maybe (Left ("bool cast", [shown value])) Right (boolFromString value)

instance SolidBool () where
  castBool = const $ Right False

class SolidBytes a where
  castBytes :: a -> CastResult B.ByteString

instance SolidBytes Integer where
  castBytes = Right . bytesFromInteger

instance SolidBytes String where
  castBytes = Right . bytesFromString

instance SolidBytes B.ByteString where
  castBytes = Right

instance SolidBytes Address where
  castBytes = Right . bytesFromAddress

instance SolidBytes () where
  castBytes = const $ Right B.empty

instance SolidBytes (String, String) where
  castBytes (value, "utf-8") = castBytes value
  castBytes (value, "raw") = Right $ bytesFromRawString value
  castBytes (value, encoding) = Left ("bytes cast", [shown value, shown encoding])

instance SolidBytes (Int, Integer) where
  castBytes (size, value) = Right $ sizedBytesFromInteger size value

instance SolidBytes (Maybe Int, String) where
  castBytes (size, value) = Right $ sizedBytesFromString size value

instance SolidBytes (Maybe Int, B.ByteString) where
  castBytes (size, value) = Right $ sizedBytesFromBytes size value

class SolidInt a where
  castInt :: a -> CastResult Integer

instance SolidInt Integer where
  castInt = Right

instance SolidInt Decimal where
  castInt = Right . integerFromDecimal

instance SolidInt T.Text where
  castInt value = castInt (value, 16 :: Integer)

instance SolidInt (T.Text, Integer) where
  castInt (value, base) = integerFromText value base

instance SolidInt String where
  castInt value = castInt (value, 16 :: Integer)

instance SolidInt (String, Integer) where
  castInt (value, base) = either (\message -> Left (message, [shown value])) Right $ parseBaseInt value base

instance SolidInt B.ByteString where
  castInt = Right . integerFromBytes

instance SolidInt Address where
  castInt = Right . integerFromAddress

instance SolidInt () where
  castInt = const $ Right 0

class SolidDecimal a where
  castDecimal :: a -> CastResult Decimal

instance SolidDecimal Integer where
  castDecimal = Right . decimalFromInteger

instance SolidDecimal Decimal where
  castDecimal = Right

instance SolidDecimal T.Text where
  castDecimal value = decimalFromText value

instance SolidDecimal String where
  castDecimal value = either (\message -> Left (message, [shown value])) Right $ decimalFromString value

instance SolidDecimal () where
  castDecimal = const $ Right 0

class SolidAddress a where
  castAddress :: a -> CastResult Address

instance SolidAddress Address where
  castAddress = Right

instance SolidAddress Integer where
  castAddress = Right . addressFromInteger

instance SolidAddress B.ByteString where
  castAddress = Right . addressFromBytes

instance SolidAddress T.Text where
  castAddress value = addressFromText value

instance SolidAddress String where
  castAddress = castAddress . T.pack

instance SolidAddress () where
  castAddress = const $ Right 0

class SolidString a where
  castString :: a -> CastResult T.Text

instance SolidString T.Text where
  castString = Right

instance SolidString String where
  castString = Right . T.pack

instance SolidString Address where
  castString = Right . T.pack . stringFromAddress

instance SolidString Integer where
  castString = Right . T.pack . show

instance SolidString Bool where
  castString = Right . T.pack . stringFromBool

instance SolidString B.ByteString where
  castString = Right . T.pack . stringFromBytes

instance SolidString () where
  castString = const $ Right T.empty

instance SolidString (Integer, Integer) where
  castString (value, base) = stringFromIntegerChecked value base Nothing

instance SolidString (Integer, Integer, Integer) where
  castString (value, base, width) = stringFromIntegerChecked value base (Just width)

instance SolidString (B.ByteString, T.Text) where
  castString (value, encoding) = stringFromEncodedBytes value encoding

instance SolidString (B.ByteString, String) where
  castString (value, encoding) = castString (value, T.pack encoding)

castResult :: MonadError CastError m => CastResult a -> m a
castResult = either throwError pure

integerFromText :: T.Text -> Integer -> CastResult Integer
integerFromText s base = case base of
  10 -> either (const $ Left ("invalid decimal integer", [shown s])) Right (readEither $ T.unpack s)
  16 ->
    let hex = fromMaybe s (T.stripPrefix (T.pack "0x") s)
        padded = if odd (T.length hex) then T.cons '0' hex else hex
    in case B16.decode (DT.encodeUtf8 padded) of
      Right encoded -> Right $ integerFromBytes encoded
      Left _ -> Left ("invalid hexadecimal integer", [shown s])
  _ -> Left ("unsupported integer base", [shown s, shown base])

decimalFromText :: T.Text -> CastResult Decimal
decimalFromText s = maybe (Left ("decimal cast", [shown s])) Right (readMaybe $ T.unpack s)

addressFromText :: T.Text -> CastResult Address
addressFromText s = maybe (Left ("address cast", [shown s])) Right (addressFromString $ T.unpack s)

stringFromIntegerChecked :: Integer -> Integer -> Maybe Integer -> CastResult T.Text
stringFromIntegerChecked n base width
  | base == 16 || (base == 10 && width == Nothing) = Right $ T.pack $ stringFromInteger n base width
  | otherwise = Left ("string cast", [shown n, shown base] ++ maybe [] (pure . shown) width)

stringFromEncodedBytes :: B.ByteString -> T.Text -> CastResult T.Text
stringFromEncodedBytes encoded encoding
  | encoding == T.pack "raw" = Right $ T.pack $ stringFromRawBytes encoded
  | encoding == T.pack "utf-8" = either
      (const $ Left ("bytestring is not UTF-8 encoded", [shown encoded, shown encoding])) Right (DT.decodeUtf8' encoded)
  | otherwise = Left ("string cast", [shown encoded, shown encoding])

shown :: Show a => a -> T.Text
shown = T.pack . show

integerFromDecimal :: Decimal -> Integer
integerFromDecimal = decimalMantissa . roundTo 0

integerFromBytes :: B.ByteString -> Integer
integerFromBytes = B.foldl' (\n w -> n * 256 + fromIntegral w) 0

decimalFromString :: String -> Either String Decimal
decimalFromString = readEither

stringFromInteger :: Integer -> Integer -> Maybe Integer -> String
stringFromInteger i 16 (Just width) = printf ("0x%0" ++ show (2*width) ++ "x") i
stringFromInteger i 16 Nothing = "0x" ++ Numeric.showHex i ""
stringFromInteger i _ _ = show i

stringFromBool :: Bool -> String
stringFromBool = Bool.bool "false" "true"

stringFromBytes :: B.ByteString -> String
stringFromBytes bs = case DT.decodeUtf8' bs of
  Left _ -> BC.unpack bs
  Right t -> T.unpack t

boolFromString :: String -> Maybe Bool
boolFromString "true" = Just True
boolFromString "false" = Just False
boolFromString _ = Nothing

bytesFromInteger :: Integer -> B.ByteString
bytesFromInteger = integer2Bytes

bytesFromString :: String -> B.ByteString
bytesFromString = DT.encodeUtf8 . T.pack

bytesFromRawString :: String -> B.ByteString
bytesFromRawString = BC.pack

sizedBytesFromInteger :: Int -> Integer -> B.ByteString
sizedBytesFromInteger size i =
  let sizeMask = (2 ^ (8 * size)) - 1
      maskedInt = i .&. sizeMask
      encoded = integer2Bytes maskedInt
  -- Pad with leading zeros to ensure correct size (e.g., bytes32 = 32 bytes)
  in B.replicate (size - B.length encoded) 0 <> encoded

sizedBytesFromString :: Maybe Int -> String -> B.ByteString
sizedBytesFromString size s = DT.encodeUtf8 $ T.pack $ maybe s (flip take s) size

addressFromInteger :: Integer -> Address
addressFromInteger = fromIntegral

addressFromString :: String -> Maybe Address
addressFromString = readMaybe

addressFromBytes :: B.ByteString -> Address
addressFromBytes = addressFromInteger . integerFromBytes

integerFromAddress :: Address -> Integer
integerFromAddress = fromIntegral . unAddress

stringFromAddress :: Address -> String
stringFromAddress = show

decimalFromInteger :: Integer -> Decimal
decimalFromInteger = Decimal 0

sizedBytesFromBytes :: Maybe Int -> B.ByteString -> B.ByteString
sizedBytesFromBytes size s = maybe s (flip B.take s) size

bytesFromAddress :: Address -> B.ByteString
bytesFromAddress = B.pack . word160ToBytes . unAddress

stringFromRawBytes :: B.ByteString -> String
stringFromRawBytes = BC.unpack
