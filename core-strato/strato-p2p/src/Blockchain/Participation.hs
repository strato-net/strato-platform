{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
module Blockchain.Participation
  ( allowOutbound
  , ParticipationMode(..)
  , setParticipationMode
  , getParticipationMode
  , remoteSetParticipationMode
  , p2pApp
  ) where

import Control.Monad.IO.Class
import Data.Aeson
import Data.Data
import GHC.Generics
import Network.HTTP.Client (newManager, defaultManagerSettings)
import Servant
import Servant.Client
import System.Exit
import System.IO.Unsafe
import Text.Printf
import UnliftIO.IORef

import Blockchain.Data.Wire

data ParticipationMode = Full
                       | None
                       | NoConsensus
                       deriving (Show, Read, Eq, Enum, Generic, FromJSON, ToJSON, Data)

{-# NOINLINE globalParticipationMode #-}
globalParticipationMode :: IORef ParticipationMode
globalParticipationMode = unsafePerformIO $ newIORef Full


setParticipationMode :: MonadIO m => ParticipationMode -> m ()
setParticipationMode mode = writeIORef globalParticipationMode mode

getParticipationMode :: MonadIO m => m ParticipationMode
getParticipationMode = readIORef globalParticipationMode

allowOutbound :: MonadIO m => Message -> m Bool
allowOutbound msg = do
  m <- getParticipationMode
  case m of
    None -> return False
    Full -> return True
    NoConsensus -> case msg of
                    Blockstanbul{} -> return False
                    _ -> return True

type P2PAPI = "participation_mode" :> Get '[JSON] ParticipationMode
         :<|> "participation_mode" :> ReqBody '[JSON] ParticipationMode :> Post '[JSON] ParticipationMode

p2pServer :: Server P2PAPI
p2pServer = getParticipationMode
       :<|> \m -> setParticipationMode m >> getParticipationMode

p2pApp :: Application
p2pApp = serve (Proxy :: Proxy P2PAPI) p2pServer

postParticipationMode :: ParticipationMode -> ClientM ParticipationMode
_ :<|> postParticipationMode = client (Proxy @ P2PAPI)

remoteSetParticipationMode :: ParticipationMode -> IO ()
remoteSetParticipationMode mode = do
  mgr <- newManager defaultManagerSettings
  let url = BaseUrl Http "localhost" 10248 ""
  eRes <- runClientM (postParticipationMode mode) $ ClientEnv mgr url Nothing
  either (die . show) (printf "Participation mode set to: %s\n" . show) eRes
