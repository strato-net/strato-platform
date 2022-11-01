{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}

import           Control.Monad
import           Control.Concurrent.Async             as Async
import           Debugger.Options() -- HFlags
import           Network.Wai.Middleware.Prometheus
import           Network.Wai.Handler.Warp
import           HFlags

import           BlockApps.Init
import           BlockApps.Logging
import           Blockchain.VMOptions() -- HFlags
import           Executable.EthereumVM
import           Executable.EVMFlags() -- HFlags
import           SolidVM.Solidity.SourceTools


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
