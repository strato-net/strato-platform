{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import BlockApps.Init
import BlockApps.Logging
import Blockchain.Context
import Blockchain.Options
import Blockchain.Participation (p2pApp, setParticipationMode)
import Blockchain.SeqEventNotify
import Blockchain.Strato.Discovery.Data.Peer (resetPeers)
import Blockchain.Strato.Model.Options ()
import Blockchain.VMOptions ()
import Control.Concurrent.Async.Lifted.Safe
import Control.Monad.IO.Class
import Data.IORef
import Data.Set.Ordered (empty)
import Executable.StratoP2P
import HFlags
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus

main :: IO ()
main = do
  runLoggingT initP2P

initP2P :: LoggingT IO ()
initP2P = do
  liftIO $ blockappsInit "strato_p2p"
  liftIO $ resetPeers
  _ <- liftIO $ $initHFlags "Strato P2P"
  setParticipationMode flags_participationMode
  wireMessagesRef <- liftIO $ newIORef empty
  cfg <- initConfig wireMessagesRef flags_maxReturnedHeaders
  let sSource = seqEventNotificationSource $ contextKafkaState initContext
      runner f = runContextM cfg $ f sSource
  liftIO $
    race_
      (run 10248 $ prometheus def p2pApp)
      (runLoggingT $ stratoP2P runner)
