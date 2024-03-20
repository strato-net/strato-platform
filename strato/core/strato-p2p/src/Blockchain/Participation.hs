{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Participation
  ( checkOutbound,
    ParticipationMode (..),
    setParticipationMode,
    getParticipationMode,
    remoteSetParticipationMode,
    p2pApp,
  )
where

import Blockchain.Data.Wire
import Blockchain.Threads
import Control.Monad.IO.Class
import Data.Aeson
import Data.Data
import qualified Data.Text as T
import GHC.Conc
import GHC.Generics
import Network.HTTP.Client (defaultManagerSettings, newManager)
import Prometheus
import Servant
import Servant.Client
import System.Exit
import System.IO.Unsafe
import Text.Printf
import UnliftIO.IORef

data ParticipationMode
  = Full
  | None
  | NoConsensus
  deriving (Show, Read, Eq, Enum, Generic, FromJSON, ToJSON, Data)

{-# NOINLINE globalParticipationMode #-}
globalParticipationMode :: IORef ParticipationMode
globalParticipationMode = unsafePerformIO $ newIORef Full

participationStats :: Vector T.Text Counter
participationStats =
  unsafeRegister
    . vector "decision"
    . counter
    $ Info "p2p_participation_stats" "Statistics about participation filters"

allow :: MonadIO m => m Bool
allow = liftIO $ withLabel participationStats "allow" incCounter >> return True

deny :: MonadIO m => m Bool
deny = liftIO $ withLabel participationStats "deny" incCounter >> return False

setParticipationMode :: MonadIO m => ParticipationMode -> m ()
setParticipationMode mode = writeIORef globalParticipationMode mode

getParticipationMode :: MonadIO m => m ParticipationMode
getParticipationMode = readIORef globalParticipationMode

checkOutbound :: MonadIO m => Message -> m Bool
checkOutbound msg = do
  m <- getParticipationMode
  case m of
    None -> deny
    Full -> allow
    NoConsensus -> case msg of
      Blockstanbul {} -> deny
      _ -> allow

type P2PAPI =
    "threads" :> Get '[JSON] [String]
    :<|> "peers" :> Get '[JSON] [String]
    :<|> "participation_mode" :> Get '[JSON] ParticipationMode
    :<|> "participation_mode" :> ReqBody '[JSON] ParticipationMode :> Post '[JSON] ParticipationMode

p2pServer :: Server P2PAPI
p2pServer =
    getThreads
    :<|> getPeers
    :<|> getParticipationMode
    :<|> \m -> setParticipationMode m >> getParticipationMode

p2pApp :: Application
p2pApp = serve (Proxy :: Proxy P2PAPI) p2pServer

postParticipationMode :: ParticipationMode -> ClientM ParticipationMode
_ :<|> _ :<|> _ :<|> postParticipationMode = client (Proxy @P2PAPI)

remoteSetParticipationMode :: ParticipationMode -> IO ()
remoteSetParticipationMode mode = do
  mgr <- newManager defaultManagerSettings
  let url = BaseUrl Http "localhost" 10248 ""
  eRes <- runClientM (postParticipationMode mode) $ mkClientEnv mgr url
  either (die . show) (printf "Participation mode set to: %s\n" . show) eRes

getThreads :: Handler [String]
getThreads = do
  threadId <- liftIO $ myThreadId
  liftIO $ labelThread threadId "p2p API"
  threads <- liftIO listThreads
  sequence $ map formatThread threads

getPeers :: Handler [String]
getPeers = do
  peersByThreads <- liftIO $ getPeersByThreads
  return $ map (\(peer, status) -> peer ++ "/" ++ status) peersByThreads
