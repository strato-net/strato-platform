{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings     #-}
import           Control.Concurrent.Async.Lifted.Safe
import           HFlags
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Prometheus

import           Blockchain.Options (flags_participationMode)
import           Blockchain.Output
import           Blockchain.Participation (p2pApp, setParticipationMode)
import           Blockchain.Strato.Discovery.Data.Peer (resetPeers)
import           Executable.StratoP2PClient
import           Executable.StratoP2PServer
import           Executable.StratoP2PLoopback
import           BlockApps.Init
import           Data.IORef
import           Data.Set.Ordered (empty)

main :: IO ()
main = do
  blockappsInit "strato_p2p"
  resetPeers
  _ <- $initHFlags "Strato P2P"
  setParticipationMode flags_participationMode
  wireMessagesRef <- newIORef empty
  race_
    (run 10248 $ prometheus def p2pApp)
    (runLoggingT $
      race_ (stratoP2PLoopback wireMessagesRef)
        (race_ (stratoP2PClient wireMessagesRef)
               (stratoP2PServer wireMessagesRef)))
