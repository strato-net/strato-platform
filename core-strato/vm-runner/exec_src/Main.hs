{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

import           Control.Monad
import           Control.Concurrent.Async             as Async
import           Network.Wai.Middleware.Prometheus
import           Network.Wai.Handler.Warp
import           HFlags

import           Blockchain.Output
import           Blockchain.VMOptions() -- HFlags
import           Executable.EthereumVM
import           Executable.EVMFlags() -- HFlags

main :: IO ()
main = do
  void $ $initHFlags "Ethereum VM"
  race_ (runLoggingT ethereumVM) (run 8000 metricsApp)
