{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.SolidVM.Builtins.Control.Metered (log, require, assert) where

import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import Prelude hiding (log)
import Blockchain.SolidVM.Execution (MonadValueOperations)
import SolidVM.Model.Value (ValList)
import qualified Blockchain.SolidVM.Builtins.Control as Original
import Blockchain.SolidVM.Builtins.Operations.Metered (invoke)
import Blockchain.SolidVM.Builtins.Size

log :: forall engine m. (MonadBuiltinGas m, MonadValueOperations engine m) => ValList -> m ()
log values = invoke (32 * fromIntegral (length values)) (Original.log @engine values)
require :: MonadBuiltinGas m => Bool -> Maybe String -> m ()
require condition message = invoke (gasSize message) (Original.require condition message)
assert :: MonadBuiltinGas m => Bool -> m ()
assert condition = invoke 0 (Original.assert condition)
