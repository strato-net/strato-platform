{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

import           Control.Monad
import           Control.Concurrent.Async             as Async
import           Debugger
import           Debugger.Options() -- HFlags
import           Network.Wai.Middleware.Prometheus
import           Network.Wai.Handler.Warp
import           HFlags

import           BlockApps.Init
import           Blockchain.Output
import           Blockchain.SolidVM.CodeCollectionDB  (compileSource)
import           Blockchain.VMOptions() -- HFlags
import           Executable.EthereumVM
import           Executable.EVMFlags() -- HFlags
import           SolidVM.Solidity.Xabi.Statement      (toSourcePosition)

main :: IO ()
main = do
  blockappsInit "vm_main"
  void $ $initHFlags "Ethereum VM"
  mDebugger <- initializeDebugger (fmap toSourcePosition . compileSource)
  let metricsRunner = run 8000 metricsApp
      debugSettings = fst <$> mDebugger
      helpers = case snd <$> mDebugger of
        Nothing -> metricsRunner
        Just debuggerRunner -> race_ metricsRunner debuggerRunner
      runVM = runLoggingT $ ethereumVM debugSettings
  race_ helpers runVM
