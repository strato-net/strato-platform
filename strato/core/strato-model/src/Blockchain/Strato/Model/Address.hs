{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedLists #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Model.Address
  ( Address (..),
    AddressPayable,
    fromPrivateKey,
    fromPublicKey,
    formatAddressWithoutColor,
    stringAddress,
    getNewAddress_unsafe,
    getNewAddressWithSalt_unsafe,
    addressToByteString,
    addressFromByteString,
    addressAsNibbleString,
    addressFromNibbleString,
    addressToHex,
    addressFromHex,
    unAddress,
    parseHex,
  )
where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.ExtendedWord (Word160, word160ToBytes)
import qualified Blockchain.Strato.Model.Keccak256 as SHA (hash, keccak256ToWord256)
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Util
import Control.DeepSeq
import Control.Lens.Operators
import Control.Monad
import qualified Data.Aeson as AS
import qualified Data.Aeson.Encoding as Enc
import qualified Data.Aeson.Key as DAK
import Data.Aeson.Types
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Lazy as BL
import Data.Char
import Data.Data
import Data.Hashable
import qualified Data.NibbleString as N
import Data.OpenApi hiding (Format, format, get, put)
import qualified Data.OpenApi as OPENAPI
import qualified Data.Text as T
import Database.Persist.Sql hiding (get)
-- import Debug.Trace
import GHC.Generics
import Numeric
import Servant.API
import Servant.Docs
import Test.QuickCheck (Arbitrary (..))
import qualified Text.Colors as CL
import Text.Format
import Text.Printf
import Text.Read (readMaybe)
import Text.ShortDescription
import Text.Tools (shorten)
import Web.FormUrlEncoded
import Web.PathPieces

instance RLPSerializable Address where
  rlpEncode (Address a) = RLPString $ BL.toStrict $ encode a
  rlpDecode (RLPString s) = Address $ decode $ BL.fromStrict s
  rlpDecode x = error ("Malformed rlp object sent to rlp2Address: " ++ show x)

type AddressPayable = Address

newtype Address = Address Word160
  deriving (Eq, Enum, Bounded, Ord, Generic, Data)
  deriving newtype (Real, Num, Integral, Hashable)

instance Show Address where
  show (Address a) = printf "%040x" a

instance Read Address where
  readsPrec _ input =
    let trimmed = dropWhile isSpace input
        (hexPart, rest) = splitAt 40 $ case trimmed of
          '0':'x':rest' -> rest'
          _ -> trimmed
    in case readHex hexPart of
         [(num, "")] -> [(Address num, rest)]
         _           -> []

instance PrintfArg Address where
  formatArg (Address word) = formatArg word

-- first byte of serialized pubkey is metdata, so we drop it
fromPrivateKey :: PrivateKey -> Address
fromPrivateKey =
  Address . fromIntegral . SHA.keccak256ToWord256 . SHA.hash . B.drop 1 . exportPublicKey False . derivePublicKey

fromPublicKey :: PublicKey -> Address
fromPublicKey = Address . fromIntegral . SHA.keccak256ToWord256 . SHA.hash . B.drop 1 . exportPublicKey False

{-
 Was necessary to make Address a primary key - which we no longer do (but rather index on the address field).
 May remove in the future
-}
instance PathPiece Address where
  toPathPiece (Address x) = T.pack $ showHex (fromIntegral $ x :: Integer) ""
  fromPathPiece t = case readHex (T.unpack t) of
    ((wd160, _) : _) -> Just (Address wd160)
    [] -> Nothing

{-
 make into a string rather than an object
-}
instance AS.ToJSON Address where
  toJSON = String . T.pack . formatAddressWithoutColor

instance AS.ToJSONKey Address where
  toJSONKey = ToJSONKeyText f (Enc.text . t)
    where
      f = DAK.fromText . T.pack . formatAddressWithoutColor
      t = T.pack . formatAddressWithoutColor

instance AS.FromJSON Address where
  parseJSON (String s) = case readHex . drop0x $ T.unpack s of
    [] -> fail $ "Could not parse Address from string " ++ T.unpack s
    (x:_) -> pure . Address $ fst x
    where
      drop0x ('0' : 'x' : cs) = cs
      drop0x ('0' : 'X' : cs) = cs
      drop0x cs = cs
  parseJSON x = typeMismatch "Address" x

instance FromJSONKey Address where
  fromJSONKey = FromJSONKeyTextParser (parseJSON . String)

instance Format Address where
  format = CL.yellow . formatAddressWithoutColor

instance ShortDescription Address where
  shortDescription x = CL.yellow . shorten 12 . padZeros 40 $ showHex x ""

instance Binary Address where
  put (Address x) = sequence_ $ fmap put $ word160ToBytes $ fromIntegral x
  get = do
    bytes <- replicateM 20 get
    let byteString = B.pack bytes
    return (Address $ fromInteger $ byteString2Integer byteString)

maybeToEither :: b -> Maybe a -> Either b a
maybeToEither err m = maybe (Left err) Right m

instance PersistField Address where
  toPersistValue = PersistText . T.pack . formatAddressWithoutColor
  fromPersistValue (PersistText t) =
    let !eAddr = maybeToEither "could not decode address"
               . stringAddress
               . T.unpack
               $ t
     in eAddr
  fromPersistValue x = Left . T.pack $ "PersistField Address: expected PersistText: " ++ show x

instance PersistFieldSql Address where
  sqlType _ = SqlString

--  sqlType _ = SqlOther "varchar(64)"

-- | Parse a hexadecimal string into an 'Address'.
--
-- The input string can be either:
--
-- * A 40-character hexadecimal string without "0x" prefix (e.g., "deadbeef00000000000000000000000000000000")
-- * A 42-character hexadecimal string with "0x" prefix (e.g., "0xdeadbeef00000000000000000000000000000000")
--
-- Returns 'Nothing' if the string is not valid hexadecimal or has incorrect length.
--
-- >>> stringAddress "deadbeef00000000000000000000000000000000"
-- Just (Address 0xdeadbeef00000000000000000000000000000000)
--
-- >>> stringAddress "0xdeadbeef00000000000000000000000000000000"
-- Just (Address 0xdeadbeef00000000000000000000000000000000)
--
-- >>> stringAddress "invalid"
-- Nothing
stringAddress :: String -> Maybe Address
stringAddress string =
  let prefixedString = if take 2 string == "0x" then string else "0x" ++ string
  in Address . fromInteger <$> readMaybe prefixedString

------------------------------------

instance FromHttpApiData Address where
  parseQueryParam x =
    case stringAddress $ T.unpack x of
      Just address -> Right address
      _ -> Left $ T.pack $ "Could not parse address: " ++ show x

instance ToForm Address where
  toForm address = [("address", toQueryParam address)]

instance FromForm Address where fromForm = parseUnique "address"

instance ToSample Address where
  toSamples _ = samples [Address 0xdeadbeef, Address 0x12345678]

instance ToCapture (Capture "address" Address) where
  toCapture _ = DocCapture "address" "an Ethereum address"

instance ToCapture (Capture "contractAddress" Address) where
  toCapture _ = DocCapture "contractAddress" "an Ethereum address"

instance ToCapture (Capture "userAddress" Address) where
  toCapture _ = DocCapture "userAddress" "an Ethereum address"

instance ToParamSchema Address where
  toParamSchema _ =
    mempty
      & type_ ?~ OpenApiString
      & minimum_ ?~ fromInteger (toInteger . unAddress $ (minBound :: Address))
      & maximum_ ?~ fromInteger (toInteger . unAddress $ (maxBound :: Address))
      & OPENAPI.format ?~ "hex string"

unAddress :: Address -> Word160
unAddress (Address n) = n

instance ToSchema Address where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "Address")
        ( mempty
            & type_ ?~ OpenApiString
            & example ?~ "address=deadbeef" --toJSON (Address 0xdeadbeef) -- FIXME if causing troubles outside /faucet
            & description ?~ "Ethereum Address, 20 byte hex encoded string"
        )

-----------------------------

instance ToHttpApiData Address where
  toUrlPiece = T.pack . formatAddressWithoutColor

instance NFData Address

getNewAddress_unsafe :: Address -> Integer -> Address
getNewAddress_unsafe a n =
  let theHash = SHA.hash $ rlpSerialize $ RLPArray [rlpEncode a, rlpEncode n]
   in decode $ BL.drop 12 $ encode theHash

-- Construct salted contract addresses using a version of the solidity CREATE2 method:
-- Original -> new_address = hash(0xFF, sender, salt, bytecode)[12::]
-- Current  -> new_address = hash(0xFF, sender, salt, codecollection_hash, args)[12::]
getNewAddressWithSalt_unsafe :: RLPSerializable a => Address -> String -> B.ByteString -> [a] -> Address
getNewAddressWithSalt_unsafe creator salt codeHash args =
  let theHash = SHA.hash $ rlpSerialize $ RLPArray $
        [rlpEncode (0xFF :: Integer), rlpEncode creator, rlpEncode salt, rlpEncode codeHash]
        ++ (rlpEncode <$> args)
   in decode $ BL.drop 12 $ encode theHash

addressToByteString :: Address -> B.ByteString
addressToByteString (Address s) = BL.toStrict $ encode s

addressFromByteString :: B.ByteString -> Address
addressFromByteString = Address . decode . BL.fromStrict

addressAsNibbleString :: Address -> N.NibbleString
addressAsNibbleString = byteString2NibbleString . addressToByteString

addressFromNibbleString :: N.NibbleString -> Address
addressFromNibbleString = addressFromByteString . nibbleString2ByteString

formatAddressWithoutColor :: Address -> String
formatAddressWithoutColor x = padZeros 40 $ showHex x ""

addressToHex :: Address -> B.ByteString
addressToHex = B16.encode . BL.toStrict . encode

addressFromHex :: B.ByteString -> Either String Address
addressFromHex hex = case B16.decode hex of
  Right h -> case decodeOrFail (BL.fromStrict h) of
    Right (_, _, a) -> return a
    Left (_, _, mesg) -> Left $ "cannot decode address: " ++ mesg
  _ -> Left $ "invalid hex address: " ++ show hex

hexChar :: Char -> Integer
hexChar ch
  | ch == '0' = 0
  | ch == '1' = 1
  | ch == '2' = 2
  | ch == '3' = 3
  | ch == '4' = 4
  | ch == '5' = 5
  | ch == '6' = 6
  | ch == '7' = 7
  | ch == '8' = 8
  | ch == '9' = 9
  | ch == 'a' = 10
  | ch == 'b' = 11
  | ch == 'c' = 12
  | ch == 'd' = 13
  | ch == 'e' = 14
  | ch == 'f' = 15
  | otherwise = 0

parseHex :: String -> Integer
parseHex [] = 0
parseHex hxStr = hexChar (last hxStr) + 16 * parseHex (init hxStr)

instance Arbitrary Address where
  arbitrary = Address <$> arbitrary
