{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Strato.Model.SHA where


import              Blockchain.Strato.Model.Util
import              Control.DeepSeq
import qualified "cryptonite" Crypto.Hash                as Cr (Digest, hash, Keccak_512)
import qualified    Data.Aeson                           as Ae
import qualified    Data.Aeson.Encoding                  as Enc
import              Data.Binary
import              Data.Binary.Get
import              Data.Binary.Put
import              Data.ByteArray                       (convert)
import qualified    Data.ByteString                      as B
import              Data.ByteString.Arbitrary
import qualified    Data.ByteString.Base16               as B16
import qualified    Data.ByteString.Char8                as S8
import qualified    Data.ByteString.Lazy                 as BL
import              Data.Data
import              Data.Hashable                        (Hashable)
import qualified    Data.Text                            as T
import              GHC.Generics
import              Numeric                              (readHex, showHex)
import              Web.HttpApiData
import              Web.PathPieces
import              Test.QuickCheck

import              FastKeccak256
import              Blockchain.Data.RLP
import              Blockchain.Strato.Model.ExtendedWord
import qualified    Text.Colors                          as CL
import              Text.Format

newtype SHA = SHA Word256 deriving (Eq, Read, Show, Ord, Generic, Data)
                          deriving anyclass (Hashable)

instance NFData SHA

unSHA :: SHA -> Word256
unSHA (SHA w) = w

instance Binary SHA where
    put (SHA x) = putByteString . word256ToBytes $ x
    get = SHA . bytesToWord256 <$> getByteString 32

instance RLPSerializable SHA where
    rlpDecode (RLPString s) | B.length s == 32 = SHA $ decode $ BL.fromStrict s
    rlpDecode (RLPScalar 0) = SHA 0 --special case seems to be allowed, even if length of zeros is wrong
    rlpDecode x             = error ("Missing case in rlpDecode for SHA: " ++ show x)
    --rlpEncode (SHA 0) = RLPNumber 0
    rlpEncode (SHA val) = RLPString $ fst $ B16.decode $ S8.pack $ padZeros 64 $ showHex val ""

instance Ae.ToJSON SHA where
  toJSON = Ae.String . T.pack . shaToHex
instance Ae.FromJSON SHA where

instance Ae.ToJSONKey SHA where
  toJSONKey = Ae.ToJSONKeyText f (Enc.text . f)
      where f = T.pack . shaToHex

shaToHex :: SHA -> String
shaToHex (SHA sha) = replicate (64 - length hex) '0' ++ hex
    where hex = showHex sha ""

-- todo: this shouldn't be partial... ever...
shaFromHex :: String -> SHA
shaFromHex = SHA . fst . head . readHex

superProprietaryStratoSHAHash :: S8.ByteString -> SHA
superProprietaryStratoSHAHash = SHA . bytesToWord256 . keccak256

keccak256 :: S8.ByteString -> S8.ByteString
keccak256 = fastKeccak256

keccak512 :: S8.ByteString -> S8.ByteString
keccak512 bs = convert (Cr.hash bs :: Cr.Digest Cr.Keccak_512)

rlpHash :: RLPSerializable a => a -> SHA
rlpHash = superProprietaryStratoSHAHash . rlpSerialize . rlpEncode

hash :: S8.ByteString -> SHA
hash = superProprietaryStratoSHAHash

formatSHAWithoutColor :: SHA -> String
formatSHAWithoutColor s@(SHA x)
  | s == hash "" = "<blank>"
  | otherwise    = padZeros 64 $ showHex x ""

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

instance PathPiece SHA where
  toPathPiece = T.pack . show
  fromPathPiece t =
    case readHex $ T.unpack t of
      [(x, "")] -> Just $ SHA x
      _         -> Nothing

instance ToHttpApiData SHA where
    toUrlPiece = toPathPiece

instance FromHttpApiData SHA where
    parseUrlPiece = unmaybe . fromPathPiece
        where unmaybe = \case
                Nothing -> Left "couldn't parse SHA"
                Just x  -> Right x

instance Arbitrary SHA where
    arbitrary = do
        random256Bit <- fastRandBs 32
        return . SHA . fromIntegral . byteString2Integer $ random256Bit

blockstanbulMixHash :: SHA
blockstanbulMixHash = SHA 0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365

