{-# LANGUAGE FlexibleInstances, TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-missing-signatures -fno-warn-unused-do-bind #-}

import Blockchain.Output
import Blockchain.Quarry.Flags ()

import Control.Monad.Logger
import HFlags

import Executable.StratoQuary

main = do
  _ <- $initHFlags "Block builder for the Haskell EVM"
  flip runLoggingT printLogMsg stratoQuary
