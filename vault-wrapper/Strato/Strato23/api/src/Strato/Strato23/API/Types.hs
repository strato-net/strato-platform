{-# LANGUAGE DataKinds     #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE DeriveGeneric  #-}

module Strato.Strato23.API.Types where

import           Crypto.Hash
import           Data.Aeson.Types
import qualified Data.ByteArray          as ByteArray
import           Data.ByteString         (ByteString)
import qualified Data.ByteString         as BS
import qualified Data.ByteString.Base16  as B16
import qualified Data.ByteString.Char8   as C8
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

-- instance (Integral n, Show n) => ToHttpApiData (Hex n) where
--   toUrlPiece = Text.pack . show
--
-- instance Arbitrary x => Arbitrary (Hex x) where
--   arbitrary = genericArbitrary uniform

newtype Keccak256 = Keccak256 { digestKeccak256 :: Digest Keccak_256 }
  deriving (Eq,Ord,Show,Generic)
keccak256ByteString :: Keccak256 -> ByteString
keccak256ByteString = ByteArray.convert . digestKeccak256

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
--instance ToJSONKey Keccak256 where
--    toJSONKey = ToJSONKeyText f f'
--        where f k = let (Aeson.String s) = toJSON k in s
--              f'  = AesonEnc.text . f
--instance FromJSONKey Keccak256 where
--    fromJSONKey = FromJSONKeyTextParser (parseJSON . Aeson.String)
--
--instance ToHttpApiData Keccak256 where
--  toUrlPiece = Text.pack . keccak256String
--
--instance FromHttpApiData Keccak256 where
--  parseUrlPiece text = case stringKeccak256 (Text.unpack text) of
--    Nothing      -> Left $ "Could not decode Keccak256: " <> text
--    Just hash256 -> Right hash256
--
--instance ToForm Keccak256 where
--  toForm hash256 = [("hash", toQueryParam hash256)]
--
--instance FromForm Keccak256 where fromForm = parseUnique "hash"
--instance MimeUnrender PlainText Keccak256 where
--  mimeUnrender _ = maybe (Left "Couldn't read Keccak") Right . stringKeccak256 . Char8.unpack . Lazy.toStrict
--instance MimeRender PlainText Keccak256 where
--  mimeRender _ = Lazy.fromStrict . Char8.pack . keccak256String
--
--instance MimeRender PlainText [Keccak256] where
--  mimeRender _ = encode
--
--instance MimeUnrender PlainText [Keccak256] where
--  mimeUnrender _ = maybe (Left "Couldn't decode [Keccak256]") Right . decode
--
--instance Arbitrary Keccak256 where
--  arbitrary = keccak256lazy . Binary.encode @ Integer <$> arbitrary
--
--instance ToCapture (Capture "hash" Keccak256) where
--  toCapture _ = DocCapture "hash" "a transaction hash"

keccak256 :: ByteString -> Keccak256
keccak256 = Keccak256 . hash
