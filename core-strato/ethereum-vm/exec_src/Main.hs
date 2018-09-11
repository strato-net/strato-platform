{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# OPTIONS -fno-warn-unused-imports #-} -- #justHFlagsThingz

import           Control.Monad
import           Control.Monad.Logger
import           Control.Concurrent.Async             as Async
import           Network.Wai.Middleware.Prometheus
import           Network.Wai.Handler.Warp
import           HFlags

import           Blockchain.Output
import           Blockchain.VMOptions
import           Executable.EthereumVM
import           Executable.EVMFlags

main :: IO ()
main = do
  void $ $initHFlags "Ethereum VM"
  race_ (runLoggingT ethereumVM printLogMsg) (run 8000 metricsApp)
