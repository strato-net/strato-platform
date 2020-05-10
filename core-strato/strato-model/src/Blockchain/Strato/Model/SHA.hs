{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE OverloadedLists #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.Strato.Model.SHA (
  SHA,
  blockstanbulMixHash,
  formatSHAWithoutColor,
  hash,
  rlpHash,
  shaFromHex,
  shaToByteString,
  shaToHex,
  shaToWord256,
  unsafeCreateSHAFromByteString,
  unsafeCreateSHAFromWord256
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

newtype SHA = SHA ByteString deriving (Eq, Read, Show, Ord, Generic, Data)
                             deriving anyclass (Hashable)

instance NFData SHA

shaToWord256 :: SHA -> Word256
shaToWord256 (SHA val) = bytesToWord256 val 

shaToByteString :: SHA -> ByteString
shaToByteString (SHA val) = val

unsafeCreateSHAFromWord256 :: Word256 -> SHA
unsafeCreateSHAFromWord256 = SHA . word256ToBytes

unsafeCreateSHAFromByteString :: ByteString -> SHA
unsafeCreateSHAFromByteString = SHA


instance Binary SHA where
    put (SHA x) = putByteString x
    get = SHA <$> getByteString 32

instance RLPSerializable SHA where
    rlpDecode (RLPString s) | B.length s == 32 = SHA s
    rlpDecode (RLPScalar 0) = unsafeCreateSHAFromWord256 0 --special case seems to be allowed, even if length of zeros is wrong
    rlpDecode x             = error ("Missing case in rlpDecode for SHA: " ++ show x)
    --rlpEncode (SHA 0) = RLPNumber 0
    rlpEncode (SHA val) = RLPString val

-- Someday we should remove the second RLP library...
instance RLP2.RLPEncodable SHA where
  rlpEncode = RLP2.rlpEncode . shaToByteString
  rlpDecode = Right . SHA <=< RLP2.rlpDecode


instance Ae.ToJSON SHA where
  toJSON = Ae.String . T.pack . shaToHex
instance Ae.FromJSON SHA where
  parseJSON = Ae.withText "SHA" $ \t ->
    case B16.decode $ BC.pack $ T.unpack t of
      (val, "") -> pure $ SHA val
      _ -> fail $ "error parsing SHA: " ++ show t

instance Ae.ToJSONKey SHA where
  toJSONKey = Ae.ToJSONKeyText f (Enc.text . f)
      where f = T.pack . shaToHex

instance Ae.FromJSONKey SHA where
    fromJSONKey = Ae.FromJSONKeyTextParser (Ae.parseJSON . Ae.String)

instance PersistField SHA where
  toPersistValue (SHA i) = PersistText . T.pack $ BC.unpack $ B16.encode i
  fromPersistValue (PersistText s) =
    case B16.decode $ BC.pack $ T.unpack s of
      (val, "") -> Right $ SHA val
      _ -> Left $ T.pack $ "unable to parse SHA: " ++ show s


    
  fromPersistValue _ = Left $ T.pack $ "PersistField SHA must be persisted as PersistText"

instance PersistFieldSql SHA where
  sqlType _ = SqlOther $ T.pack "varchar(64)"


shaToHex :: SHA -> String
shaToHex (SHA sha) = BC.unpack $ B16.encode sha

-- todo: this shouldn't be partial... ever...
shaFromHex :: String -> SHA
shaFromHex = SHA . fst . B16.decode . BC.pack

formatSHAWithoutColor :: SHA -> String
formatSHAWithoutColor s
  | s == hash "" = "<blank>"
  | otherwise    = shaToHex s



rlpHash :: RLPSerializable a => a -> SHA
rlpHash = hash . rlpSerialize . rlpEncode

hash :: BC.ByteString -> SHA
hash = SHA . fastKeccak256


instance Format SHA where
  format = CL.yellow . formatSHAWithoutColor


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
instance PathPiece SHA where
  toPathPiece = T.pack . show
  fromPathPiece t =
    case B16.decode $ BC.pack $ T.unpack t of
      (x, "") -> Just $ SHA x
      _         -> Nothing

instance ToHttpApiData SHA where
  toUrlPiece (SHA bytes) = T.pack . BC.unpack . B16.encode $ bytes

instance FromHttpApiData SHA where
    parseUrlPiece = unmaybe . fromPathPiece
        where unmaybe = \case
                Nothing -> Left "couldn't parse SHA"
                Just x  -> Right x

instance MimeUnrender PlainText SHA where
  mimeUnrender _ v =
    case B16.decode $ BLC.toStrict v of
      (bytes, "") -> Right $ SHA bytes
      _ -> Left "Couldn't read Keccak"

instance MimeRender PlainText SHA where
  mimeRender _ = BLC.pack . formatSHAWithoutColor

instance MimeRender PlainText [SHA] where
  mimeRender _ = Ae.encode

instance MimeUnrender PlainText [SHA] where
  mimeUnrender _ val = maybe (Left $ "Couldn't decode [Keccak256] in SHA: " ++ show val) Right . Ae.decode $ val

instance ToForm SHA where
  toForm hash256 = [("hash", toQueryParam hash256)]

instance FromForm SHA where
  fromForm = parseUnique "hash"


instance Arbitrary SHA where
    arbitrary = do
        random256Bit <- fastRandBs 32
        return $ SHA random256Bit

instance ToCapture (Capture "hash" SHA) where
  toCapture _ = DocCapture "hash" "a transaction hash"

instance ToParamSchema SHA where
  toParamSchema _ = mempty & type_ .~ SwaggerString

instance ToSample SHA where
  toSamples _ =
    samples [hash $ BLC.toStrict (encode @ Integer n) | n <- [1..10]]

instance ToSchema SHA where
  declareNamedSchema _ = return $
    NamedSchema (Just "Keccak256 hash, 32 byte hex encoded string")
      ( mempty
        & type_ .~ SwaggerString
        & example ?~ Ae.toJSON (hash $ BLC.toStrict (encode @ Integer 1))
        & description ?~ "Keccak256 hash, 32 byte hex encoded string" )

blockstanbulMixHash :: SHA
blockstanbulMixHash = unsafeCreateSHAFromWord256 0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365
