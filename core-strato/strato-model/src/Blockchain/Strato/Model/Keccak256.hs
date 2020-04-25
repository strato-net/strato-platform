{-# OPTIONS_GHC -fno-warn-orphans  #-}
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedLists       #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE TypeApplications      #-}

module Blockchain.Strato.Model.Keccak256 where

import           ClassyPrelude ((<>), Hashable(hashWithSalt))
import           Control.DeepSeq (NFData)
import           Control.Lens.Operators
import           Control.Monad          ((<=<))
import           Crypto.Hash
import qualified Data.Aeson             as Aeson
import           Data.Aeson
import qualified Data.Aeson.Encoding    as AesonEnc
import qualified Data.Binary            as Binary
import qualified Data.ByteArray         as ByteArray
import           Data.ByteString        (ByteString)
import qualified Data.ByteString        as ByteString
import qualified Data.ByteString.Base16 as Base16
import qualified Data.ByteString.Char8  as Char8
import qualified Data.ByteString.Lazy   as Lazy
import           Data.Maybe
import           Data.RLP
import           Data.Swagger
import qualified Data.Text              as Text
import           GHC.Generics
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck        hiding ((.&.))
import           Web.FormUrlEncoded     hiding (fieldLabelModifier)

import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.SHA    hiding (hash)

newtype Keccak256 = Keccak256 { digestKeccak256 :: Digest Keccak_256 }
  deriving (Eq,Ord,Show,Generic)
  deriving anyclass (NFData)


instance RLPEncodable Keccak256 where
  rlpEncode = rlpEncode . keccak256ByteString
  rlpDecode = maybe (Left "RLPEncodable.Keccak256: Could not decode") Right . byteStringKeccak256 <=< rlpDecode


instance Hashable Keccak256 where
  hashWithSalt salt = hashWithSalt salt . keccak256SHA

keccak256ByteString :: Keccak256 -> ByteString
keccak256ByteString = ByteArray.convert . digestKeccak256

byteStringKeccak256 :: ByteString -> Maybe Keccak256
byteStringKeccak256 = fmap Keccak256 . digestFromByteString

keccak256String :: Keccak256 -> String
keccak256String (Keccak256 digest) = show digest

stringKeccak256 :: String -> Maybe Keccak256
stringKeccak256 string =
  if ByteString.null r then Keccak256 <$> digestFromByteString bs else Nothing
  where
    (bs, r) = Base16.decode $ Char8.pack string

instance ToJSON Keccak256 where toJSON = toJSON . keccak256String

instance FromJSON Keccak256 where
  parseJSON value = do
    string <- parseJSON value
    case stringKeccak256 string of
      Nothing      -> fail $ "Could not decode Keccak256: " <> string
      Just hash256 -> return hash256
instance ToJSONKey Keccak256 where
    toJSONKey = ToJSONKeyText f f'
        where f k = let (Aeson.String s) = toJSON k in s
              f'  = AesonEnc.text . f
instance FromJSONKey Keccak256 where
    fromJSONKey = FromJSONKeyTextParser (parseJSON . Aeson.String)

instance ToHttpApiData Keccak256 where
  toUrlPiece = Text.pack . keccak256String

instance FromHttpApiData Keccak256 where
  parseUrlPiece text = case stringKeccak256 (Text.unpack text) of
    Nothing      -> Left $ "Could not decode Keccak256: " <> text
    Just hash256 -> Right hash256

instance ToForm Keccak256 where
  toForm hash256 = [("hash", toQueryParam hash256)]

instance FromForm Keccak256 where fromForm = parseUnique "hash"
instance MimeUnrender PlainText Keccak256 where
  mimeUnrender _ = maybe (Left "Couldn't read Keccak") Right . stringKeccak256 . Char8.unpack . Lazy.toStrict
instance MimeRender PlainText Keccak256 where
  mimeRender _ = Lazy.fromStrict . Char8.pack . keccak256String

instance MimeRender PlainText [Keccak256] where
  mimeRender _ = encode

instance MimeUnrender PlainText [Keccak256] where
  mimeUnrender _ = maybe (Left "Couldn't decode [Keccak256]") Right . decode

instance Arbitrary Keccak256 where
  arbitrary = keccak256lazy . Binary.encode @ Integer <$> arbitrary

instance ToCapture (Capture "hash" Keccak256) where
  toCapture _ = DocCapture "hash" "a transaction hash"

keccak256 :: ByteString -> Keccak256
keccak256 = Keccak256 . hash

keccak256lazy :: Lazy.ByteString -> Keccak256
keccak256lazy = Keccak256 . hashlazy

instance ToSample Keccak256 where
  toSamples _ =
    samples [keccak256lazy (Binary.encode @ Integer n) | n <- [1..10]]

instance ToSchema Keccak256 where
  declareNamedSchema _ = return $
    NamedSchema (Just "Keccak256 hash, 32 byte hex encoded string")
      ( mempty
        & type_ .~ SwaggerString
        & example ?~ toJSON (keccak256lazy (Binary.encode @ Integer 1))
        & description ?~ "Keccak256 hash, 32 byte hex encoded string" )

keccak256SHA :: Keccak256 -> SHA
keccak256SHA = SHA . bytesToWord256 . ByteArray.convert . digestKeccak256

shaKeccak256 :: SHA -> Keccak256
shaKeccak256 (SHA hsh) = Keccak256
                       . fromMaybe (error $ "internal error: shaKeccak256" ++ show hsh)
                       . digestFromByteString
                       $ word256ToBytes hsh
