{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Main where
-- HFlags

import BlockApps.Init
import BlockApps.Logging
-- HFlags
import Blockchain.Strato.Model.Options ()
import Blockchain.VMOptions ()
import Control.Concurrent.Async as Async
import Control.Monad
import Executable.EVMFlags ()
import Executable.EthereumVM
import HFlags
import Instrumentation
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus
-- HFlags

main :: IO ()
main = do
  blockappsInit "vm_main"
  runInstrumentation "vm-runner"
  void $ $initHFlags "Ethereum VM"
  let metricsRunner = run 8009 metricsApp
      runVM = runLoggingT ethereumVM
  race_ metricsRunner runVM
