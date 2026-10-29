module Blockchain.SolidVM.Builtins.ABI.Values.Metered
  ( abiEncode, abiEncodePacked, abiDecode, encodeArguments ) where

import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import qualified Blockchain.SolidVM.Builtins.ABI.Values as Original
import Blockchain.SolidVM.Builtins.Operations.Metered (invoke, invokeSized)
import Blockchain.SolidVM.Builtins.Size (GasSize)
import qualified Blockchain.SolidVM.Builtins.ABI as ABI
import Blockchain.SolidVM.Builtins.Size.Values (valueSize)
import qualified Data.ByteString as B
import SolidVM.Model.Value

abiEncode, abiEncodePacked :: MonadBuiltinGas m => [Value] -> m B.ByteString
abiEncode values = invoke (sum (map valueSize values)) (Original.abiEncode values)
abiEncodePacked values = invoke (sum (map valueSize values)) (Original.abiEncodePacked values)

abiDecode :: MonadBuiltinGas m => B.ByteString -> [Value] -> m Value
abiDecode bytes types = invoke (fromIntegral (B.length bytes)) (pure (Original.abiDecode bytes types))

encodeArguments :: (MonadBuiltinGas m, GasSize args) => Bool -> args -> m [(Bool, B.ByteString)] -> m B.ByteString
encodeArguments packed args fields = invokeSized args (ABI.encodeArguments packed <$> fields)
