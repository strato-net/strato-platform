{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings     #-}
import           Control.Monad.IO.Class
import           Control.Concurrent.Async.Lifted.Safe
import           Blockchain.VMOptions       ()

import           HFlags
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Prometheus

import           Blockchain.Context
import           Blockchain.Options
import           Blockchain.Strato.Model.Options()
import           Blockchain.Participation (p2pApp, setParticipationMode)
import           Blockchain.SeqEventNotify
import           Blockchain.Strato.Discovery.Data.Peer (resetPeers)
import           Executable.StratoP2P
import           BlockApps.Init
import           BlockApps.Logging
import           Data.IORef
import           Data.Set.Ordered (empty)

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
  liftIO $ race_
    (run 10248 $ prometheus def p2pApp)
    (runLoggingT $ stratoP2P runner)
