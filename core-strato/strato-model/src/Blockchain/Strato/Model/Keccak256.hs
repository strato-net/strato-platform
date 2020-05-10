{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE OverloadedLists #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.Strato.Model.Keccak256 (
  Keccak256,
  SHA,
  blockstanbulMixHash,
  formatKeccak256WithoutColor,
  hash,
  rlpHash,
  keccak256FromHex,
  keccak256ToByteString,
  keccak256ToHex,
  keccak256ToWord256,
  unsafeCreateKeccak256FromByteString,
  unsafeCreateKeccak256FromWord256,

  keccak256SHA,
  shaKeccak256,
  stringKeccak256,
  keccak256,
  keccak256lazy,
  keccak256String,
  byteStringKeccak256
  ) where


import              Control.DeepSeq
import              Control.Lens.Operators
import              Control.Monad          ((<=<))
import qualified    Data.Aeson                           as Ae
import qualified    Data.Aeson.Encoding                  as Enc
import              Data.Binary
import              Data.Binary.Get
import              Data.Binary.Put
import              Data.ByteString                      (ByteString)
import qualified    Data.ByteString                      as B
import              Data.ByteString.Arbitrary
import qualified    Data.ByteString.Base16               as B16
import qualified    Data.ByteString.Char8                as BC
import qualified    Data.ByteString.Lazy                 as BL
import qualified    Data.ByteString.Lazy.Char8           as BLC
import              Data.Data
import              Data.Hashable                        (Hashable)
import qualified    Data.RLP                             as RLP2 --someday we have to remove the extra RLP library
import              Data.Swagger                         hiding (Format)
import qualified    Data.Text                            as T
import              Database.Persist.Sql
import              GHC.Generics
import              Servant
import              Servant.Docs
import              Test.QuickCheck
import              Web.FormUrlEncoded                   hiding (fieldLabelModifier)
import              Web.PathPieces

import              FastKeccak256
import              Blockchain.Data.RLP
import              Blockchain.Strato.Model.ExtendedWord
import qualified    Text.Colors                          as CL
import              Text.Format

import qualified    Blockchain.Strato.Model.SHA          as THEREALSHA


newtype Keccak256 = Keccak256 ByteString deriving (Eq, Read, Show, Ord, Generic, Data)
                             deriving anyclass (Hashable)

newtype SHA = SHA ByteString deriving (Eq, Read, Show, Ord, Generic, Data)
                             deriving anyclass (Hashable)

instance NFData Keccak256

keccak256ToWord256 :: Keccak256 -> Word256
keccak256ToWord256 (Keccak256 val) = bytesToWord256 val 

--shaToByteString :: SHA -> ByteString
--shaToByteString (SHA val) = val

keccak256ToByteString :: Keccak256 -> ByteString
keccak256ToByteString (Keccak256 val) = val

unsafeCreateKeccak256FromByteString :: ByteString -> Keccak256
unsafeCreateKeccak256FromByteString = Keccak256

unsafeCreateKeccak256FromWord256 :: Word256 -> Keccak256
unsafeCreateKeccak256FromWord256 = Keccak256 . word256ToBytes
{-
unsafeCreateKeccak256FromByteString :: ByteString -> Keccak256
unsafeCreateKeccak256FromByteString = Keccak256
-}



instance Binary Keccak256 where
    put (Keccak256 x) = putByteString x
    get = Keccak256 <$> getByteString 32

instance RLPSerializable Keccak256 where
    rlpDecode (RLPString s) | B.length s == 32 = Keccak256 s
    rlpDecode (RLPScalar 0) = unsafeCreateKeccak256FromWord256 0 --special case seems to be allowed, even if length of zeros is wrong
    rlpDecode x             = error ("Missing case in rlpDecode for Keccak256: " ++ show x)
    --rlpEncode (Keccak256 0) = RLPNumber 0
    rlpEncode (Keccak256 val) = RLPString val

-- Someday we should remove the second RLP library...
instance RLP2.RLPEncodable Keccak256 where
  rlpEncode = RLP2.rlpEncode . keccak256ToByteString
  rlpDecode = Right . Keccak256 <=< RLP2.rlpDecode


instance Ae.ToJSON Keccak256 where
  toJSON = Ae.String . T.pack . keccak256ToHex
instance Ae.FromJSON Keccak256 where
  parseJSON = Ae.withText "Keccak256" $ \t ->
    case B16.decode $ BC.pack $ T.unpack t of
      (val, "") -> pure $ Keccak256 val
      _ -> fail $ "error parsing Keccak256: " ++ show t

instance Ae.ToJSONKey Keccak256 where
  toJSONKey = Ae.ToJSONKeyText f (Enc.text . f)
      where f = T.pack . keccak256ToHex

instance Ae.FromJSONKey Keccak256 where
    fromJSONKey = Ae.FromJSONKeyTextParser (Ae.parseJSON . Ae.String)

instance PersistField Keccak256 where
  toPersistValue (Keccak256 i) = PersistText . T.pack $ BC.unpack $ B16.encode i
  fromPersistValue (PersistText s) =
    case B16.decode $ BC.pack $ T.unpack s of
      (val, "") -> Right $ Keccak256 val
      _ -> Left $ T.pack $ "unable to parse Keccak256: " ++ show s


    
  fromPersistValue _ = Left $ T.pack $ "PersistField Keccak256 must be persisted as PersistText"

instance PersistFieldSql Keccak256 where
  sqlType _ = SqlOther $ T.pack "varchar(64)"


keccak256ToHex :: Keccak256 -> String
keccak256ToHex (Keccak256 sha) = BC.unpack $ B16.encode sha

-- todo: this shouldn't be partial... ever...
keccak256FromHex :: String -> Keccak256
keccak256FromHex = Keccak256 . fst . B16.decode . BC.pack

formatKeccak256WithoutColor :: Keccak256 -> String
formatKeccak256WithoutColor s
  | s == hash "" = "<blank>"
  | otherwise    = keccak256ToHex s



rlpHash :: RLPSerializable a => a -> Keccak256
rlpHash = hash . rlpSerialize . rlpEncode

hash :: BC.ByteString -> Keccak256
hash = Keccak256 . fastKeccak256


instance Format Keccak256 where
  format = CL.yellow . formatKeccak256WithoutColor


-- I think we want this first definition, but the API already uses the second one!
-- Someday we should fix this, but it will probably change our external (API) behavior.
{-
instance PathPiece SHA where
  toPathPiece (SHA x) = T.pack $ padZeros 64 $ showHex x ""
  fromPathPiece t = Just (SHA wd160)
    where
      ((wd160, _):_) = readHex $ T.unpack $ t ::  [(Word256,String)]
-}

-- Note!  PathPiece can be removed once we stop using Yesod/strato-api
instance PathPiece Keccak256 where
  toPathPiece = T.pack . show
  fromPathPiece t =
    case B16.decode $ BC.pack $ T.unpack t of
      (x, "") -> Just $ Keccak256 x
      _         -> Nothing

instance ToHttpApiData Keccak256 where
  toUrlPiece (Keccak256 bytes) = T.pack . BC.unpack . B16.encode $ bytes

instance FromHttpApiData Keccak256 where
    parseUrlPiece = unmaybe . fromPathPiece
        where unmaybe = \case
                Nothing -> Left "couldn't parse Keccak256"
                Just x  -> Right x

instance MimeUnrender PlainText Keccak256 where
  mimeUnrender _ v =
    case B16.decode $ BLC.toStrict v of
      (bytes, "") -> Right $ Keccak256 bytes
      _ -> Left "Couldn't read Keccak"

instance MimeRender PlainText Keccak256 where
  mimeRender _ = BLC.pack . formatKeccak256WithoutColor

instance MimeRender PlainText [Keccak256] where
  mimeRender _ = encode

instance MimeUnrender PlainText [Keccak256] where
  mimeUnrender _ = maybe (Left "Couldn't decode [Keccak256]") Right . decode

instance ToForm Keccak256 where
  toForm hash256 = [("hash", toQueryParam hash256)]

instance FromForm Keccak256 where
  fromForm = parseUnique "hash"


instance Arbitrary Keccak256 where
    arbitrary = do
        random256Bit <- fastRandBs 32
        return $ Keccak256 random256Bit

instance ToCapture (Capture "hash" Keccak256) where
  toCapture _ = DocCapture "hash" "a transaction hash"

instance ToParamSchema Keccak256 where
  toParamSchema _ = mempty & type_ .~ SwaggerString

instance ToSample Keccak256 where
  toSamples _ =
    samples [hash $ BLC.toStrict (encode @ Integer n) | n <- [1..10]]

instance ToSchema Keccak256 where
  declareNamedSchema _ = return $
    NamedSchema (Just "Keccak256 hash, 32 byte hex encoded string")
      ( mempty
        & type_ .~ SwaggerString
        & example ?~ Ae.toJSON (hash $ BLC.toStrict (encode @ Integer 1))
        & description ?~ "Keccak256 hash, 32 byte hex encoded string" )

blockstanbulMixHash :: Keccak256
blockstanbulMixHash = unsafeCreateKeccak256FromWord256 0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365




{-
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

-- {-# OPTIONS_GHC -fno-warn-unused-imports  #-}
-- {-# OPTIONS_GHC -fno-warn-unused-top-binds  #-}


module Blockchain.Strato.Model.Keccak256 (
  Keccak256,
  byteStringKeccak256,
  keccak256,
  keccak256ByteString,
  keccak256lazy,
  keccak256SHA,
  keccak256String,
  shaKeccak256,
  stringKeccak256
  ) where

--import           ClassyPrelude ((<>), Hashable(hashWithSalt))
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

import           Blockchain.Strato.Model.SHA    hiding (hash)

newtype Keccak256 = Keccak256 { digestKeccak256 :: Digest Keccak_256 }
  deriving (Eq,Ord,Show,Generic)
  deriving anyclass (NFData)

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

instance RLPEncodable Keccak256 where
  rlpEncode = rlpEncode . keccak256ByteString
  rlpDecode = maybe (Left "RLPEncodable.Keccak256: Could not decode") Right . byteStringKeccak256 <=< rlpDecode
{-
instance Hashable Keccak256 where
  hashWithSalt salt = hashWithSalt salt . keccak256SHA
-}

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
{-
instance MimeRender PlainText Keccak256 where
  mimeRender _ = Lazy.fromStrict . Char8.pack . keccak256String
-}
instance MimeRender PlainText [Keccak256] where
  mimeRender _ = encode

instance MimeUnrender PlainText [Keccak256] where
  mimeUnrender _ = maybe (Left "Couldn't decode [Keccak256]") Right . decode

instance Arbitrary Keccak256 where
  arbitrary = keccak256lazy . Binary.encode @ Integer <$> arbitrary

instance ToCapture (Capture "hash" Keccak256) where
  toCapture _ = DocCapture "hash" "a transaction hash"

instance ToParamSchema Keccak256 where
  toParamSchema _ = mempty & type_ .~ SwaggerString


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



keccak256 :: ByteString -> Keccak256
keccak256 = Keccak256 . hash

keccak256lazy :: Lazy.ByteString -> Keccak256
keccak256lazy = Keccak256 . hashlazy


keccak256SHA :: Keccak256 -> SHA
keccak256SHA = unsafeCreateSHAFromByteString . ByteArray.convert . digestKeccak256

shaKeccak256 :: SHA -> Keccak256
shaKeccak256 hsh = Keccak256
                   . fromMaybe (error $ "internal error: shaKeccak256" ++ show hsh)
                   . digestFromByteString
                   $ shaToByteString hsh
-}


keccak256SHA :: Keccak256 -> THEREALSHA.SHA
keccak256SHA (Keccak256 val) = THEREALSHA.unsafeCreateSHAFromByteString val

shaKeccak256 :: THEREALSHA.SHA -> Keccak256
shaKeccak256 sha = Keccak256 $ THEREALSHA.shaToByteString sha

stringKeccak256 :: String -> Maybe Keccak256
stringKeccak256 string =
  case B16.decode $ BC.pack string of
    (x, "") -> Just $ Keccak256 x
    _ -> Nothing

keccak256 :: ByteString -> Keccak256
keccak256 = hash

keccak256lazy :: BL.ByteString -> Keccak256
keccak256lazy = hash . BL.toStrict

keccak256String :: Keccak256 -> String
keccak256String = formatKeccak256WithoutColor

byteStringKeccak256 :: ByteString -> Maybe Keccak256
byteStringKeccak256 = Just . Keccak256 
