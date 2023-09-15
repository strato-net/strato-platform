{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE OverloadedStrings     #-}

import           Control.Monad.Change.Modify (Modifiable(..))
import           Control.Monad
--import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Trans.Control
--import           Control.Concurrent.Async.Lifted.Safe
import           Blockchain.VMOptions       ()
import           UnliftIO.Async

import           HFlags

import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Prometheus
import qualified Network.Kafka as K

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

--initP2P :: ( Modifiable K.KafkaState (LoggingT m)
--           , MonadUnliftIO m
--           )
--        => LoggingT m ()
initP2P = do
  liftIO $ blockappsInit "strato_p2p"
  liftIO $ resetPeers
  _ <- liftIO $ $initHFlags "Strato P2P"
  setParticipationMode flags_participationMode
  wireMessagesRef <- liftIO $ newIORef empty
  cfg <- initConfig wireMessagesRef flags_maxReturnedHeaders
  initContextF <- liftIO initContext
  _ <- withAsync (forever $ seqEventNotificationSourceChanFill (return $ contextKafkaState initContextF) (contextKafkaMiddleman initContextF)) $ \res -> waitCatch res
  let sSource = seqEventNotificationSourceChanPour $ contextKafkaMiddleman initContextF
      runner f = runContextM cfg $ f sSource
  liftIO $ race_
    (run 10248 $ prometheus def p2pApp)
    (runLoggingT $ stratoP2P runner)
