{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.SolidVM.Builtins.Functions where

import Prelude hiding (log)
import Blockchain.Data.RLP
import Blockchain.Data.Util (integer2Bytes)
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.Model.Secp256k1 as EC
import Blockchain.Strato.Model.Util (byteString2Integer)
import Blockchain.VM.SolidException (invalidArguments, malformedData)
import qualified Blockchain.VM.SolidException as Exception
import Control.Monad (unless)
import Control.Monad.IO.Class (MonadIO)
import Crypto.ECC (Curve_P256R1)
import Crypto.Error
import "crypton" Crypto.Hash (SHA256, digestFromByteString)
import qualified Crypto.Hash.RIPEMD160 as RIPEMD160
import qualified Crypto.Hash.SHA256 as SHA256
import qualified Crypto.PubKey.ECC.P256 as P256
import Crypto.PubKey.ECDSA (signatureFromIntegers, verifyDigest)
import qualified Crypto.Secp256k1 as SEC
import Data.Bits ((.&.))
import Data.Bool (bool)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Base64 as B64
import qualified Data.ByteString.Base64.URL as B64URL
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Short as BSS
import Data.Decimal
import Data.Maybe (fromMaybe)
import Data.Proxy (Proxy (..))
import qualified Data.Text as T
import qualified Data.Text.Encoding as DT
import Data.Time.Clock
import Data.Word (Word8)
import qualified Numeric (showHex)
import Text.Printf (printf)
import Text.Read (readEither, readMaybe)

identity :: a -> a
identity = id

variadic :: [a] -> [a]
variadic = id

parseBaseInt :: String -> Integer -> Either String Integer
parseBaseInt s n =
  case n of
    10 -> readEither s
    16 ->
      let s' = case s of
                 '0':'x':rest -> rest
                 _ -> s
          prefix' = bool "0" "" . even $ length s'
       in case B16.decode (BC.pack $ prefix' ++ s') of
            Right l -> Right $ byteString2Integer l
            _ -> Left $ "numeric cast - not a hex string " <> s
    _ -> Left $ "Cannot convert string " <> s <> " to base " <> show n

integerFromDecimal :: Decimal -> Integer
integerFromDecimal = decimalMantissa . roundTo 0

integerFromBytes :: B.ByteString -> Integer
integerFromBytes = byteString2Integer

decimalFromString :: String -> Either String Decimal
decimalFromString = readEither

stringFromInteger :: Integer -> Integer -> Maybe Integer -> String
stringFromInteger i 16 (Just width) = printf ("0x%0" ++ show (2*width) ++ "x") i
stringFromInteger i 16 Nothing = "0x" ++ Numeric.showHex i ""
stringFromInteger i _ _ = show i

stringFromBool :: Bool -> String
stringFromBool = bool "false" "true"

stringFromBytes :: B.ByteString -> String
stringFromBytes bs = case DT.decodeUtf8' bs of
  Left _ -> BC.unpack bs
  Right t -> T.unpack t

stringFromUtf8 :: B.ByteString -> String
stringFromUtf8 bs = case DT.decodeUtf8' bs of
  Left _ -> malformedData "bytestring is not UTF-8 encoded" bs
  Right t -> T.unpack t

boolFromString :: String -> Maybe Bool
boolFromString "true" = Just True
boolFromString "false" = Just False
boolFromString _ = Nothing

byte :: Integer -> Integer
byte n = n .&. 0xff

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
      bytes = integer2Bytes maskedInt
  -- Pad with leading zeros to ensure correct size (e.g., bytes32 = 32 bytes)
  in B.replicate (size - B.length bytes) 0 <> bytes

sizedBytesFromString :: Maybe Int -> String -> B.ByteString
sizedBytesFromString size s = DT.encodeUtf8 $ T.pack $ maybe s (flip take s) size

addmod, mulmod :: Integer -> Integer -> Integer -> Integer
addmod a b c = (a + b) `mod` c
mulmod a b c = (a * b) `mod` c

b16encode :: B.ByteString -> B.ByteString
b16encode = B16.encode

b16decode :: B.ByteString -> B.ByteString
b16decode input =
  let padded = if odd (B.length input) then B.cons 48 input else input
   in case B16.decode padded of
        Right decoded -> decoded
        Left _ -> invalidArguments "b16decode: invalid hex string" input

normalizeHex :: String -> String
normalizeHex input =
  let hexPart = case input of
        '0' : 'x' : rest -> rest
        _ -> input
      encoded = DT.encodeUtf8 $ T.pack hexPart
      padded = if odd (B.length encoded) then B.cons 48 encoded else encoded
   in case B16.decode padded of
        Right decoded -> "0x" ++ BC.unpack (B16.encode decoded)
        Left _ -> invalidArguments "normalizeHex: invalid hex string" input

keccak256 :: B.ByteString -> B.ByteString
keccak256 = keccak256ToByteString . hash

keccak256Hex :: RLPObject -> String
keccak256Hex = keccak256ToHex . hash . rlpSerialize

sha256, ripemd160, base64encode, base64urlencode :: B.ByteString -> B.ByteString
sha256 = SHA256.hash
ripemd160 = RIPEMD160.hash
base64encode = B64.encode
base64urlencode = BC.takeWhile (/= '=') . B64URL.encode

hashHex :: (B.ByteString -> B.ByteString) -> RLPObject -> String
hashHex digest = BC.unpack . B16.encode . digest . rlpSerialize

base64String :: (B.ByteString -> B.ByteString) -> String -> String
base64String encode = BC.unpack . encode . DT.encodeUtf8 . T.pack

ecrecover :: B.ByteString -> Integer -> Integer -> Integer -> Address
ecrecover bs v r s = fromMaybe 0 $ fromPublicKey <$> EC.recoverPub sig mesg
  where
    intToBSS = BSS.toShort . word256ToBytes . fromInteger
    sig = EC.Signature (SEC.CompactRecSig (intToBSS r) (intToBSS s) ((fromInteger v :: Word8) - 0x1b))
    mesg = keccak256ToByteString $ unsafeCreateKeccak256FromByteString bs

verifyP256 :: Monad m => B.ByteString -> m (Either (Integer, Integer) B.ByteString) -> m (Integer, Integer) -> m Bool
verifyP256 h publicKey signature = case digestFromByteString @SHA256 h of
  Nothing -> invalidArguments "Could not decode hash from string" h
  Just digest -> do
    key <- publicKey
    pub <- case key of
      Left coordinates -> pure $ P256.pointFromIntegers coordinates
      Right pubBS' -> do
        pubBS <- case B.length pubBS' of
          65 -> pure $ B.drop 1 pubBS'
          64 -> pure pubBS'
          _ -> invalidArguments "Could not decode public key from bytestring: invalid length" pubBS'
        case P256.pointFromBinary pubBS of
          CryptoPassed p -> pure p
          CryptoFailed e -> invalidArguments "Could not decode public key from bytestring" (pubBS', e)
    (r,s) <- signature
    sig <- case signatureFromIntegers (Proxy @Curve_P256R1) (r, s) of
      CryptoPassed sig' -> pure sig'
      CryptoFailed e -> invalidArguments "Invalid P256 signature" e
    let !isValidSig = verifyDigest (Proxy @Curve_P256R1) pub sig digest
    pure isValidSig

blockhash :: Monad m => (Integer -> m (Maybe B.ByteString)) -> Integer -> m String
blockhash lookupHash blockNum = do
  if blockNum < 0
    then invalidArguments "blockhash() only accepts arguments greater than or equal to 0" [blockNum]
    else pure ()
  maybeTheHash <- lookupHash blockNum
  maybe (invalidArguments "the block number given does not exist" [blockNum]) (pure . BC.unpack) maybeTheHash

selfdestruct :: Monad m => m address -> (address -> m Integer) -> (address -> m ()) -> (address -> address -> Integer -> m Bool) -> (address -> m ()) -> address -> m Bool
selfdestruct currentAddress balance clearCode pay purge recipient = do
  contract <- currentAddress
  amount <- balance contract
  clearCode contract
  sent <- pay contract recipient amount
  purge contract
  pure sent

create :: Monad m => m result -> m code -> (code -> m address) -> (address -> code -> m result) -> String -> String -> m result
create reject compile allocateAddress execute name source
  | null name || null source = reject
  | otherwise = do
      code <- compile
      address <- allocateAddress code
      execute address code

create2 :: Monad m => m result -> m code -> (code -> m address) -> (address -> code -> m result) -> String -> String -> m result
create2 = create

setBlockContext :: Monad m => Bool -> m () -> m proposer -> m facts -> (proposer -> facts -> m ()) -> m ()
setBlockContext testing reject proposer facts update = do
  unless testing reject
  p <- proposer
  f <- facts
  update p f

fastForward :: Monad m => Bool -> m () -> UTCTime -> Integer -> Integer -> Integer -> (UTCTime -> Integer -> m ()) -> m ()
fastForward testing reject timestamp blockNumber seconds blocks update = do
  unless testing reject
  update (addUTCTime (max 1 $ fromIntegral seconds) timestamp) (blockNumber + blocks)

log :: Monad m => (a -> m ()) -> [a] -> m ()
log = mapM_

require :: MonadIO m => Bool -> Maybe String -> m ()
require = Exception.require

assert :: MonadIO m => Bool -> m ()
assert = Exception.assert

push :: Monad m => m Int -> (Int -> m ()) -> (Int -> m ()) -> m Int
push getLength setLength setElement = do
  len <- getLength
  setLength (len + 1)
  setElement len
  pure (len + 1)

addressFromInteger :: Integer -> Address
addressFromInteger = fromIntegral

addressFromString :: String -> Maybe Address
addressFromString = readMaybe

addressFromBytes :: B.ByteString -> Address
addressFromBytes = Address . bytesToWord160 . B.unpack

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

stringConcat :: Monad m => (Int -> m ()) -> [String] -> m String
stringConcat charge strs = do
  charge $ sum $ length <$> strs
  pure $ concat strs
