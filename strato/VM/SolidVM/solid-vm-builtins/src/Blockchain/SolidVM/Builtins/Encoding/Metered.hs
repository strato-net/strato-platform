module Blockchain.SolidVM.Builtins.Encoding.Metered (b16encode, b16decode, normalizeHex, bytes32ToString) where

import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import qualified Blockchain.SolidVM.Builtins.Encoding as Original
import Blockchain.SolidVM.Builtins.Operations.Metered (invoke)
import Blockchain.SolidVM.Builtins.Size
import qualified Data.ByteString as B

b16encode, b16decode :: MonadBuiltinGas m => B.ByteString -> m B.ByteString
b16encode value = invoke (gasSize value) (pure (Original.b16encode value))
b16decode value = invoke (gasSize value) (pure (Original.b16decode value))
normalizeHex, bytes32ToString :: MonadBuiltinGas m => String -> m String
normalizeHex value = invoke (gasSize value) (pure (Original.normalizeHex value))
bytes32ToString value = invoke (gasSize value) (pure (Original.bytes32ToString value))
