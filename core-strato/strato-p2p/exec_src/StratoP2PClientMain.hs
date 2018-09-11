{-# LANGUAGE TemplateHaskell #-}
import           Control.Concurrent.Async
import           Control.Monad.Logger
import           HFlags
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Prometheus

import           Blockchain.Options         ()
import           Blockchain.Output
import           Executable.StratoP2PClient

main :: IO ()
main = do
  _ <- $initHFlags "Strato Peer Client"
  race_
    (run 10248 metricsApp)
    (flip runLoggingT printLogMsg stratoP2PClient)
