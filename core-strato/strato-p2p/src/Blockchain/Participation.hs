{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE TypeOperators #-}
module Blockchain.Participation
  ( allowOutbound
  , ParticipationMode(..)
  , setParticipationMode
  , getParticipationMode
  , p2pApp
  ) where

import Control.Monad.IO.Class
import Data.Aeson
import GHC.Generics
import Servant
import System.IO.Unsafe
import UnliftIO.IORef

import Blockchain.Data.Wire

data ParticipationMode = Full
                       | None
                       | NoConsensus
                       deriving (Show, Read, Eq, Enum, Generic, FromJSON, ToJSON)

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
