{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators     #-}

module Strato.Strato23.API.Types where

import           Control.Lens           ((&), (.~), (?~))
import           Crypto.Hash
import           Data.Aeson.Types
import qualified Data.Binary            as B
import qualified Data.ByteArray         as BA
import           Data.ByteString        (ByteString)
import qualified Data.ByteString        as BS
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8  as C8
import qualified Data.ByteString.Lazy   as BL
import           Data.LargeWord
import           Data.Swagger
import           Data.Word
import           GHC.Generics
import           Numeric
import           Text.Read
import           Text.Read.Lex

newtype Hex n = Hex { unHex :: n } deriving (Eq, Generic)

instance (Integral n, Show n) => Show (Hex n) where
  show (Hex n) = showHex n ""

instance (Eq n, Num n) => Read (Hex n) where
  readPrec = Hex <$> readP_to_Prec (const readHexP)
  --I'm not sure what `d` precision parameter is used for

instance Num n => FromJSON (Hex n) where
  parseJSON value = do
    string <- parseJSON value
    case fmap fromInteger (readMaybe ("0x" ++ string)) of
      Nothing -> fail $ "not hex encoded: " ++ string
      Just n  -> return $ Hex n

instance (Integral n, Show n) => ToJSON (Hex n) where
  toJSON = toJSON . show

newtype Address = Address { unAddress :: Word160 }
  deriving (Eq, Ord, Generic, Bounded)

-- instance NFData Address

instance Show Address where show = addressString

-- instance ToJSONKey Address where
--   toJSONKey = ToJSONKeyText f g
--     where f x = Text.pack $ addressString x
--           g x = AesonEnc.text . Text.pack $ addressString x

padZeros :: Int -> String -> String
padZeros n string = replicate (n - length string) '0' ++ string

show256 :: Word256 -> String
show256 (LargeKey w64 w192) = (show192 w192) ++ (show64 w64)

show192 :: Word192 -> String
show192 (LargeKey w64 w128) = (show128 w128) ++ (show64 w64)

show160 :: Word160 -> String
show160 (LargeKey w32 w128) = (show128 w128) ++ (show32 w32)

show128 :: Word128 -> String
show128 (LargeKey w1 w2) = (show64 w2) ++ (show64 w1)

show64 :: Word64 -> String
show64 w64 = padZeros 16 (showHex w64 "")

show32 :: Word32 -> String
show32 w32 = padZeros 8 (showHex w32 "")

addressString :: Address -> String
addressString (Address address) = show160 address

stringAddress :: String -> Maybe Address
stringAddress string = Address . fromInteger <$> readMaybe ("0x" ++ string)

instance ToJSON Address where toJSON = toJSON . addressString

instance FromJSON Address where
  parseJSON value = do
    string <- parseJSON value
    case stringAddress string of
      Nothing      -> fail $ "Could not decode Address: " <> string
      Just address -> return address

-- instance ToHttpApiData Address where
--   toUrlPiece = Text.pack . addressString
-- 
-- instance FromHttpApiData Address where
--   parseUrlPiece text = case stringAddress (Text.unpack text) of
--     Nothing      -> Left $ "Could not decode Address: " <> text
--     Just address -> Right address
-- 
-- instance ToForm Address where
--   toForm address = [("address", toQueryParam address)]
-- 
-- instance FromForm Address where fromForm = parseUnique "address"
-- 
-- instance Arbitrary Address where
--   arbitrary = Address . fromInteger <$> arbitrary
-- 
-- instance ToSample Address where
--   toSamples _ = samples [Address 0xdeadbeef, Address 0x12345678]
-- 
-- instance ToCapture (Capture "address" Address) where
--   toCapture _ = DocCapture "address" "an Ethereum address"
-- 
-- instance ToCapture (Capture "contractAddress" Address) where
--   toCapture _ = DocCapture "contractAddress" "an Ethereum address"
-- 
-- instance RLPEncodable Address where
--   rlpEncode addr = rlpEncode . fst . Base16.decode . Char8.pack $ addressString addr
--   rlpDecode obj = Address . fromInteger <$> rlpDecode obj
-- 
-- instance RLPEncodable (Maybe Address) where
--   rlpEncode = maybe rlp0 rlpEncode
--   rlpDecode x = if x == rlp0 then return Nothing else Just <$> rlpDecode x
-- 
-- instance ToCapture (Capture "userAddress" Address) where
--   toCapture _ = DocCapture "userAddress" "an Ethereum address"
-- 
-- instance ToParamSchema Address where
--   toParamSchema _ = mempty
--     & type_ .~ SwaggerString
--     & minimum_ ?~ fromInteger (toInteger . unAddress $ (minBound :: Address))
--     & maximum_ ?~ fromInteger (toInteger . unAddress $ (maxBound :: Address))
--     & format ?~ "hex string"

instance ToSchema Address where
  declareNamedSchema _ = return $
    NamedSchema (Just "Address")
      ( mempty
        & type_ .~ SwaggerString
        & example ?~ "00000000000000000000000000000000deadbeef"
        & description ?~ "Ethereum Address, 20 byte hex encoded string" )

--------------------------------------------------------------------------

newtype Keccak256 = Keccak256 { digestKeccak256 :: Digest Keccak_256 }
  deriving (Eq,Ord,Show,Generic)
keccak256ByteString :: Keccak256 -> ByteString
keccak256ByteString = BA.convert . digestKeccak256

byteStringKeccak256 :: ByteString -> Maybe Keccak256
byteStringKeccak256 = fmap Keccak256 . digestFromByteString

keccak256String :: Keccak256 -> String
keccak256String (Keccak256 digest) = show digest

stringKeccak256 :: String -> Maybe Keccak256
stringKeccak256 string =
  if BS.null r then Keccak256 <$> digestFromByteString bs else Nothing
  where
    (bs, r) = B16.decode $ C8.pack string

instance ToJSON Keccak256 where toJSON = toJSON . keccak256String

instance FromJSON Keccak256 where
  parseJSON value = do
    string <- parseJSON value
    case stringKeccak256 string of
      Nothing      -> fail $ "Could not decode Keccak256: " <> string
      Just hash256 -> return hash256

keccak256 :: ByteString -> Keccak256
keccak256 = Keccak256 . hash

keccak256Address :: ByteString -> Address
keccak256Address
  = Address
  . B.decode
  . BL.fromStrict
  . BS.drop 12
  . BA.convert
  . digestKeccak256
  . keccak256
