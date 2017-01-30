{-# LANGUAGE DeriveGeneric #-}
module Blockchain.Strato.Model.SHA where

import           Blockchain.Strato.Model.ExtendedWord (Word256, word256ToBytes)
import           Blockchain.Strato.Model.Util
import           Control.Monad                        (replicateM)
import qualified Crypto.Hash.SHA3                     as SuperProprietaryWrongFuckingHash
import           Data.Binary
import qualified Data.ByteString                      as B
import qualified Data.ByteString.Base16               as B16
import qualified Data.ByteString.Char8                as S8
import qualified Data.ByteString.Lazy                 as BL
import           GHC.Generics
import           Numeric                              (showHex, readHex)

import           Blockchain.Data.RLP

newtype SHA = SHA Word256 deriving (Eq, Read, Show, Ord, Generic)

instance Binary SHA where
    put (SHA x) = sequence_ (put <$> word256ToBytes x)
    get = SHA . fromInteger . byteString2Integer . B.pack <$> replicateM 32 get

instance RLPSerializable SHA where
    rlpDecode (RLPString s) | B.length s == 32 = SHA $ decode $ BL.fromStrict s
    rlpDecode (RLPScalar 0) = SHA 0 --special case seems to be allowed, even if length of zeros is wrong
    rlpDecode x = error ("Missing case in rlpDecode for SHA: " ++ show x)
    --rlpEncode (SHA 0) = RLPNumber 0
    rlpEncode (SHA val) = RLPString $ fst $ B16.decode $ S8.pack $ padZeros 64 $ showHex val ""

shaToHex :: SHA -> String
shaToHex (SHA sha) = replicate (64 - length hex) '0' ++ hex
    where hex = showHex sha ""

-- todo: this shouldn't be partial... ever...
shaFromHex :: String -> SHA
shaFromHex = SHA . fst . head . readHex

superProprietaryStratoSHAHash :: S8.ByteString -> SHA
superProprietaryStratoSHAHash = SHA . fromIntegral . byteString2Integer . SuperProprietaryWrongFuckingHash.hash 256