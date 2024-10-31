{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedLists #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.Strato.Model.Keccak256
  ( Keccak256,
    RLPHashable(..),
    blockstanbulMixHash,
    formatKeccak256WithoutColor,
    hash,
    emptyHash,
    zeroHash,
    keccak256FromHex,
    keccak256ToByteString,
    keccak256ToHex,
    keccak256ToWord256,
    unsafeCreateKeccak256FromByteString,
    unsafeCreateKeccak256FromWord256,
    stringKeccak256,
  )
where

--someday we have to remove the extra RLP library

import Blockchain.Data.RLP
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Util
import Control.DeepSeq
import Control.Lens.Operators
import qualified Data.Aeson as Ae
import qualified Data.Aeson.Encoding as Enc
import qualified Data.Aeson.Key as DAK
import Data.Binary
import Data.Binary.Get
import Data.Binary.Put
import Data.ByteString (ByteString)
import qualified Data.ByteString as B
import Data.ByteString.Arbitrary
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy.Char8 as BLC
import Data.Data
import Data.Hashable (Hashable)
import Data.Swagger hiding (Format)
import qualified Data.Text as T
import Database.Persist.Sql
import FastKeccak256
import GHC.Generics
import qualified LabeledError
import Servant
import Servant.Docs
import Test.QuickCheck
import qualified Text.Colors as CL
import Text.Format
import Web.FormUrlEncoded hiding (fieldLabelModifier)
import Web.PathPieces

newtype Keccak256 = Keccak256 ByteString
  deriving (Eq, Read, Show, Ord, Generic, Data)
  deriving anyclass (Hashable)

newtype SHA = SHA ByteString
  deriving (Eq, Read, Show, Ord, Generic, Data)
  deriving anyclass (Hashable)

instance NFData Keccak256

keccak256ToWord256 :: Keccak256 -> Word256
keccak256ToWord256 (Keccak256 val) = bytesToWord256 val

keccak256ToByteString :: Keccak256 -> ByteString
keccak256ToByteString (Keccak256 val) = val

unsafeCreateKeccak256FromByteString :: ByteString -> Keccak256
unsafeCreateKeccak256FromByteString = Keccak256

unsafeCreateKeccak256FromWord256 :: Word256 -> Keccak256
unsafeCreateKeccak256FromWord256 = Keccak256 . word256ToBytes

instance Binary Keccak256 where
  put (Keccak256 x) = putByteString x
  get = Keccak256 <$> getByteString 32

instance RLPSerializable Keccak256 where
  rlpDecode (RLPString s) | B.length s == 32 = Keccak256 s
  rlpDecode (RLPScalar 0) = unsafeCreateKeccak256FromWord256 0 --special case seems to be allowed, even if length of zeros is wrong
  rlpDecode x = error ("Missing case in rlpDecode for Keccak256: " ++ show x)

  --rlpEncode (Keccak256 0) = RLPNumber 0
  rlpEncode (Keccak256 val)
    | B.length val >= 32 = RLPString $ B.take 32 val
    | otherwise =
      RLPString $
        B.replicate (32 - B.length val) 0
          `B.append` val

instance Ae.ToJSON Keccak256 where
  toJSON = Ae.String . T.pack . keccak256ToHex

instance Ae.FromJSON Keccak256 where
  parseJSON = Ae.withText "Keccak256" $ \t ->
    case B16.decode $ BC.pack $ T.unpack t of
      Right val -> pure $ Keccak256 val
      _ -> fail $ "error parsing Keccak256: " ++ show t

instance Ae.ToJSONKey Keccak256 where
  toJSONKey = Ae.ToJSONKeyText f (Enc.text . t)
    where
      f = DAK.fromText . T.pack . keccak256ToHex
      t = T.pack . keccak256ToHex

instance Ae.FromJSONKey Keccak256 where
  fromJSONKey = Ae.FromJSONKeyTextParser (Ae.parseJSON . Ae.String)

instance PersistField Keccak256 where
  toPersistValue (Keccak256 i) = PersistText . T.pack $ BC.unpack $ B16.encode i
  fromPersistValue (PersistText s) =
    case B16.decode $ BC.pack $ T.unpack s of
      Right val -> Right $ Keccak256 val
      _ -> Left $ T.pack $ "unable to parse Keccak256: " ++ show s
  fromPersistValue _ = Left $ T.pack $ "PersistField Keccak256 must be persisted as PersistText"

instance PersistFieldSql Keccak256 where
  sqlType _ = SqlOther $ T.pack "varchar(64)"

keccak256ToHex :: Keccak256 -> String
keccak256ToHex (Keccak256 sha) = BC.unpack $ B16.encode sha

-- todo: this shouldn't be partial... ever...
keccak256FromHex :: String -> Keccak256
keccak256FromHex = Keccak256 . LabeledError.b16Decode "keccak256FromHex" . BC.pack . padZeros 64

stringKeccak256 :: String -> Maybe Keccak256
stringKeccak256 string =
  case B16.decode $ BC.pack (padZeros 64 string) of
    Right x -> Just $ Keccak256 x
    _ -> Nothing

formatKeccak256WithoutColor :: Keccak256 -> String
formatKeccak256WithoutColor s
  | s == hash "" = "<blank>"
  | otherwise = keccak256ToHex s

class RLPHashable a where
  rlpHash :: a -> Keccak256

instance RLPSerializable a => RLPHashable a where
  rlpHash = hash . rlpSerialize . rlpEncode

hash :: BC.ByteString -> Keccak256
hash = Keccak256 . fastKeccak256

{-# NOINLINE emptyHash #-}
emptyHash :: Keccak256
emptyHash = hash ""

{-# NOINLINE zeroHash #-}
zeroHash :: Keccak256
zeroHash = unsafeCreateKeccak256FromWord256 0

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
      Right x -> Just $ Keccak256 x
      _ -> Nothing

instance ToHttpApiData Keccak256 where
  toUrlPiece (Keccak256 bytes) = T.pack . BC.unpack . B16.encode $ bytes

instance FromHttpApiData Keccak256 where
  parseUrlPiece = unmaybe . fromPathPiece
    where
      unmaybe = \case
        Nothing -> Left "couldn't parse Keccak256"
        Just x -> Right x

instance MimeUnrender PlainText Keccak256 where
  mimeUnrender _ v =
    case B16.decode $ BLC.toStrict v of
      Right bytes -> Right $ Keccak256 bytes
      _ -> Left "Couldn't read Keccak"

instance MimeRender PlainText Keccak256 where
  mimeRender _ = BLC.pack . formatKeccak256WithoutColor

instance MimeRender PlainText [Keccak256] where
  mimeRender _ = Ae.encode

instance MimeUnrender PlainText [Keccak256] where
  mimeUnrender _ val =
    maybe (Left $ "Couldn't decode [Keccak256]: " ++ show val) Right . Ae.decode $ val

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
  toParamSchema _ = mempty & type_ ?~ SwaggerString

instance ToSample Keccak256 where
  toSamples _ =
    samples [hash $ BLC.toStrict (encode @Integer n) | n <- [1 .. 10]]

instance ToSchema Keccak256 where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "Keccak256 hash, 32 byte hex encoded string")
        ( mempty
            & type_ ?~ SwaggerString
            & example ?~ Ae.toJSON (hash $ BLC.toStrict (encode @Integer 1))
            & description ?~ "Keccak256 hash, 32 byte hex encoded string"
        )

blockstanbulMixHash :: Keccak256
blockstanbulMixHash = unsafeCreateKeccak256FromWord256 0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365
