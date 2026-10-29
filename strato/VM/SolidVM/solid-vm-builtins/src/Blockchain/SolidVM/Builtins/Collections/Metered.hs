{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.SolidVM.Builtins.Collections.Metered (identity, variadic, push, stringConcat) where

import Blockchain.SolidVM.Execution (MonadValueOperations)
import SolidVM.Model.Value (Value, Variable, ValList)
import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import qualified Blockchain.SolidVM.Builtins.Collections as Original
import Blockchain.SolidVM.Builtins.Gas
import Blockchain.SolidVM.Builtins.Operations.Metered (invoke)

identity :: MonadBuiltinGas m => a -> m a
identity value = invoke 0 (pure (Original.identity value))
variadic :: MonadBuiltinGas m => [a] -> m [a]
variadic values = invoke (32 * fromIntegral (length values)) (pure (Original.variadic values))
push :: forall engine m. (MonadBuiltinGas m, MonadValueOperations engine m) => Value -> Maybe Variable -> ValList -> m Variable
push array variable values = invoke 0 (Original.push @engine array variable values)
stringConcat :: MonadBuiltinGas m => [String] -> m String
stringConcat values = chargeOperation (fromIntegral (sum (map length values))) >> pure (Original.stringConcat values)
