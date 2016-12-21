{-# LANGUAGE FlexibleInstances, TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-missing-signatures -fno-warn-unused-do-bind #-}

module Executable.StratoQuary (
  stratoQuary
  ) where

import Blockchain.EthConf ()
import Blockchain.Stream.VMEvent
import Blockchain.Quarry
import Blockchain.Quarry.Flags ()
import Blockchain.Quarry.SQL.Conn
import Control.Monad
import Control.Monad.Logger

stratoQuary::LoggingT IO ()
stratoQuary = do
  runConnT $ do
    asSimpleTransaction setupTriggers
    forever $ do
      produceVMEvents [NewUnminedBlockAvailable]
      waitNotification
