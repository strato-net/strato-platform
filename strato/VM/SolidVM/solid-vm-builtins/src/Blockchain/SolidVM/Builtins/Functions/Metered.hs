module Blockchain.SolidVM.Builtins.Functions.Metered
  ( module Functions, stringConcat, contractCast, contractCode ) where

import Blockchain.SolidVM.Builtins.Functions as Functions hiding (stringConcat, contractCast, contractCode)
import qualified Blockchain.SolidVM.Builtins.Functions as Original
import Blockchain.SolidVM.Builtins.Gas

stringConcat :: MonadBuiltinGas m => [String] -> m String
stringConcat values = chargeOperation (fromIntegral (sum (map length values))) >> pure (Original.stringConcat values)

contractCast :: MonadBuiltinGas m => a -> m a
contractCast value = chargeBuiltinGas 500 >> pure (Original.contractCast value)

contractCode :: MonadBuiltinGas m => [String] -> m String
contractCode values = chargeBuiltinGas 1000 >> pure (Original.contractCode values)
