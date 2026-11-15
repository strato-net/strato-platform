module Blockchain.SolidVM.Builtins.Modular.Metered (byte, addmod, mulmod) where

import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import qualified Blockchain.SolidVM.Builtins.Modular as Original
import Blockchain.SolidVM.Builtins.Operations.Metered (invoke)
import Blockchain.SolidVM.Builtins.Size
import Control.Exception (evaluate)
import Control.Monad.IO.Class (liftIO)

byte :: MonadBuiltinGas m => Integer -> m Integer
byte value = invoke (gasSize value) (pure (Original.byte value))
addmod, mulmod :: MonadBuiltinGas m => Integer -> Integer -> Integer -> m Integer
addmod a b c = invoke (gasSize a + gasSize b + gasSize c) (liftIO (evaluate (Original.addmod a b c)))
mulmod a b c = invoke (gasSize a * gasSize b + gasSize c) (liftIO (evaluate (Original.mulmod a b c)))
