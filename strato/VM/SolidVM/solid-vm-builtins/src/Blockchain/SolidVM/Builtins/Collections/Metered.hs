{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.SolidVM.Builtins.Collections.Metered (identity, variadic, push, stringConcat) where

import Blockchain.SolidVM.Execution (MonadValueOperations)
import SolidVM.Model.Value (Value (SArray), Variable, ValList)
import qualified Data.Vector as V
import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import qualified Blockchain.SolidVM.Builtins.Collections as Original
import Blockchain.SolidVM.Builtins.Gas
import Blockchain.SolidVM.Builtins.Operations.Metered (invoke, memoryPush)
import Blockchain.SolidVM.Builtins.Size.Values (chargeCopy)

identity :: MonadBuiltinGas m => a -> m a
identity value = invoke 0 (pure (Original.identity value))
variadic :: MonadBuiltinGas m => [a] -> m [a]
variadic values = invoke (32 * fromIntegral (length values)) (pure (Original.variadic values))
push :: forall engine m. (MonadBuiltinGas m, MonadValueOperations engine m) => Value -> Maybe Variable -> ValList -> m Variable
push array variable values = mapM_ chargeCopy values >> memoryPush (memoryLength array) >> Original.push @engine array variable values
  where
    memoryLength (SArray elements) = V.length elements
    memoryLength _ = 0
stringConcat :: MonadBuiltinGas m => [String] -> m String
stringConcat values = chargeOperation (fromIntegral (sum (map length values))) >> pure (Original.stringConcat values)
