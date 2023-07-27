{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

-- HFlags

import BlockApps.Init
import BlockApps.Logging
import Blockchain.VMOptions ()
import Control.Concurrent.Async as Async
import Control.Monad
import Debugger.Options ()
-- HFlags

import Executable.EVMFlags ()
import Executable.EthereumVM
import HFlags
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus
-- HFlags
import SolidVM.Solidity.SourceTools

main :: IO ()
main = do
  blockappsInit "vm_main"
  void $ $initHFlags "Ethereum VM"
  mDebugger <- initializeSolidVMDebuggerSimple
  let metricsRunner = run 8009 metricsApp
      debugSettings = fst <$> mDebugger
      helpers = case snd <$> mDebugger of
        Nothing -> metricsRunner
        Just debuggerRunner -> race_ metricsRunner debuggerRunner
      runVM = runLoggingT $ ethereumVM debugSettings
  race_ helpers runVM
