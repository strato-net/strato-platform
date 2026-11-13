{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.SolidVM.Builtins.Control (log, require, assert) where

import Prelude hiding (log)
import qualified Blockchain.VM.SolidException as Exception
import Control.Monad.IO.Class (MonadIO, liftIO)
import Blockchain.SolidVM.Execution
import SolidVM.Model.Value (ValList)

log :: forall engine m. MonadValueOperations engine m => ValList -> m ()
log = mapM_ (\value -> forceBuiltinValue @engine value >>= showBuiltinValue @engine >>= liftIO . putStrLn)

require :: MonadIO m => Bool -> Maybe String -> m ()
require = Exception.require

assert :: MonadIO m => Bool -> m ()
assert = Exception.assert
