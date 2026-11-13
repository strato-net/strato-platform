module Blockchain.SolidVM.Builtins.Hashing.Metered (keccak256, keccak256Hex, sha256, ripemd160, base64encode, base64urlencode, hashHex, base64String) where

import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import qualified Blockchain.SolidVM.Builtins.Hashing as Original
import Blockchain.SolidVM.Builtins.Operations.Metered (invoke)
import Blockchain.SolidVM.Builtins.Size
import Blockchain.Data.RLP
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Base16 as B16
import qualified Data.Text as T
import qualified Data.Text.Encoding as T

keccak256 :: MonadBuiltinGas m => B.ByteString -> m B.ByteString
keccak256 value = invoke (gasSize value) (pure (Original.keccak256 value))
keccak256Hex :: MonadBuiltinGas m => RLPObject -> m String
keccak256Hex = hashHex Original.keccak256
sha256, ripemd160, base64encode, base64urlencode :: MonadBuiltinGas m => B.ByteString -> m B.ByteString
sha256 value = invoke (gasSize value) (pure (Original.sha256 value))
ripemd160 value = invoke (gasSize value) (pure (Original.ripemd160 value))
base64encode value = invoke (gasSize value) (pure (Original.base64encode value))
base64urlencode value = invoke (gasSize value) (pure (Original.base64urlencode value))
hashHex :: MonadBuiltinGas m => (B.ByteString -> B.ByteString) -> RLPObject -> m String
hashHex digest value =
  let bytes = rlpSerialize value
   in invoke (gasSize bytes) (pure (BC.unpack (B16.encode (digest bytes))))
base64String :: MonadBuiltinGas m => (B.ByteString -> B.ByteString) -> String -> m String
base64String encode value =
  let bytes = T.encodeUtf8 (T.pack value)
   in invoke (gasSize bytes) (pure (BC.unpack (encode bytes)))
