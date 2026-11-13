module Blockchain.SolidVM.Builtins.Hashing (keccak256, keccak256Hex, sha256, ripemd160, base64encode, base64urlencode, hashHex, base64String) where

import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.Text as T
import qualified Data.Text.Encoding as DT
import Blockchain.Data.RLP
import Blockchain.Strato.Model.Keccak256
import qualified Crypto.Hash.RIPEMD160 as RIPEMD160
import qualified Crypto.Hash.SHA256 as SHA256
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Base64 as B64
import qualified Data.ByteString.Base64.URL as B64URL

keccak256 :: B.ByteString -> B.ByteString
keccak256 = keccak256ToByteString . hash

keccak256Hex :: RLPObject -> String
keccak256Hex = keccak256ToHex . hash . rlpSerialize

sha256, ripemd160, base64encode, base64urlencode :: B.ByteString -> B.ByteString
sha256 = SHA256.hash
ripemd160 = RIPEMD160.hash
base64encode = B64.encode
base64urlencode = BC.takeWhile (/= '=') . B64URL.encode

hashHex :: (B.ByteString -> B.ByteString) -> RLPObject -> String
hashHex digest = BC.unpack . B16.encode . digest . rlpSerialize

base64String :: (B.ByteString -> B.ByteString) -> String -> String
base64String encode = BC.unpack . encode . DT.encodeUtf8 . T.pack
