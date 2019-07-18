{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings     #-}
import           Control.Concurrent.Async.Lifted.Safe
import           HFlags
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Prometheus

import           Blockchain.Options         ()
import           Blockchain.Output
import           Blockchain.Strato.Discovery.Data.Peer (resetPeers)
import           Executable.StratoP2PClient
import           Executable.StratoP2PServer
import           Executable.StratoP2PLoopback
import           BlockApps.Init

main :: IO ()
main = do
  blockappsInit "strato_p2p"
  resetPeers
  _ <- $initHFlags "Strato P2P"
  race_
    (run 10248 metricsApp)
    (runLoggingT $
      race_ stratoP2PLoopback
        (race_ stratoP2PClient
               stratoP2PServer))
