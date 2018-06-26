{-# LANGUAGE ConstraintKinds #-}
module Blockchain.Blockstanbul.StateMachine where

import Control.Monad.IO.Class

type StateMachineM m = (MonadIO m)
