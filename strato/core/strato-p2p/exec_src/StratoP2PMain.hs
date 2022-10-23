{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings     #-}
import           Control.Concurrent.Async.Lifted.Safe
import           HFlags
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Prometheus

import           Blockchain.Context
import           Blockchain.Options
import           Blockchain.Participation (p2pApp, setParticipationMode)
import           Blockchain.SeqEventNotify
import           Blockchain.Strato.Discovery.Data.Peer (resetPeers)
import           Executable.StratoP2P
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
  let runner f = do
        cfg <- initConfig wireMessagesRef flags_maxReturnedHeaders
        let sSource = seqEventNotificationSource $ contextKafkaState initContext
        runContextM cfg $ f sSource
  race_
    (run 10248 $ prometheus def p2pApp)
    (stratoP2P runner)