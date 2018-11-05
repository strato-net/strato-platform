{-# LANGUAGE TemplateHaskell #-}
import           Control.Concurrent.Async.Lifted.Safe
import           Control.Monad.Logger
import           HFlags
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Prometheus

import           Blockchain.Options         ()
import           Blockchain.Output
import           Executable.StratoP2PClient
import           Executable.StratoP2PServer

main :: IO ()
main = do
  _ <- $initHFlags "Strato P2P"
  race_
    (run 10248 metricsApp)
    (flip runLoggingT printLogMsg $
      race_ stratoP2PClient
            stratoP2PServer)
