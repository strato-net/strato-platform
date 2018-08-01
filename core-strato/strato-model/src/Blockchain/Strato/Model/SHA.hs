{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE PackageImports #-}
module Blockchain.Strato.Model.SHA where

import              Blockchain.Strato.Model.ExtendedWord (Word256, word256ToBytes)
import              Blockchain.Strato.Model.Util
import              Control.Monad                        (replicateM)
import "cryptonite" Crypto.Hash                          (Digest, hash)
import              Crypto.Hash.Algorithms               (Keccak_256, Keccak_512)
import qualified    Data.Aeson                           as Ae
import qualified    Data.Aeson.Encoding                  as Enc
import              Data.Binary
import              Data.ByteArray                       (convert)
import qualified    Data.ByteString                      as B
import qualified    Data.ByteString.Base16               as B16
import qualified    Data.ByteString.Char8                as S8
import qualified    Data.ByteString.Lazy                 as BL
import qualified    Data.Text                            as T
import              GHC.Generics
import              Numeric                              (readHex, showHex)

import              Blockchain.Data.RLP

newtype SHA = SHA Word256 deriving (Eq, Read, Show, Ord, Generic)

unSHA :: SHA -> Word256
unSHA (SHA w) = w

instance Binary SHA where
    put (SHA x) = sequence_ (put <$> word256ToBytes x)
    get = SHA . fromInteger . byteString2Integer . B.pack <$> replicateM 32 get

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
superProprietaryStratoSHAHash = SHA . fromIntegral . byteString2Integer . keccak256

keccak256 :: S8.ByteString -> S8.ByteString
keccak256 bs = convert (hash bs :: Digest Keccak_256)

keccak512 :: S8.ByteString -> S8.ByteString
keccak512 bs = convert (hash bs :: Digest Keccak_512)
