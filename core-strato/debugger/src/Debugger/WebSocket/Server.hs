{-# LANGUAGE DataKinds         #-} -- DEBUGGING
{-# LANGUAGE LambdaCase        #-} -- DEBUGGING
{-# LANGUAGE RecordWildCards   #-} -- DEBUGGING
{-# LANGUAGE TypeOperators     #-} -- DEBUGGING
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Debugger.WebSocket.Server
  ( wsDebugger
  ) where

import           Control.Monad
import           Control.Concurrent.Async as Async
import           Control.Exception        hiding (Handler)
import           Control.Monad.IO.Class
import           Data.Aeson
import qualified Data.Text                as T
import           Data.Foldable            (for_)
import qualified Network.WebSockets       as WS
import           UnliftIO.STM
import           Debugger.Server
import           Debugger.Types
import           Debugger.WebSocket.Api

wsDebuggerServer :: TVar Bool -> DebugSettings -> WS.ServerApp
wsDebuggerServer inUse dSettings pending = do
    putStrLn "Accepting WS Connection"
    conn <- WS.acceptRequest pending
    WS.withPingThread conn 30 (return ()) $ do
        occupied <- atomically $ do
          alreadyOccupied <- readTVar inUse
          if alreadyOccupied
            then pure True
            else False <$ writeTVar inUse True
        putStrLn $ "Is WS Connection occupied: " ++ show occupied
        if occupied
          then broadcast "Debugger in use. Please try again later." conn
          else flip finally disconnect $ talk conn dSettings
        putStrLn "WS Connection disconnected"
        where
          disconnect = do
            atomically $ writeTVar inUse False
            void $ removeBreakpoints [] dSettings
            void $ resume dSettings

wsDebuggerController :: MonadIO m => WSDebuggerInput -> DebugSettings -> m (Maybe WSDebuggerOutput)
wsDebuggerController = \case
  WSIStatus -> fmap (Just . WSOStatus) . status
  WSIPause -> fmap (const Nothing) . pause
  WSIResume -> fmap (const Nothing) . resume
  WSIGetBreakpoints -> fmap (Just . WSOBreakpoints) . getBreakpoints
  WSIAddBreakpoints b -> fmap (const Nothing) . addBreakpoints b
  WSIRemoveBreakpoints b -> fmap (const Nothing) . removeBreakpoints b
  WSIClearBreakpoints -> fmap (const Nothing) . removeBreakpoints []
  WSIClearBreakpointsPath p -> fmap (const Nothing) . removeBreakpointsPath p
  WSIStepIn -> fmap (const Nothing) . stepIn
  WSIStepOver -> fmap (const Nothing) . stepOver
  WSIStepOut -> fmap (const Nothing) . stepOut
  WSIGetStackTrace -> fmap (f $ WSOStackTrace . debugStateCallStack) . status
  WSIGetVariables -> fmap (f $ WSOVariables . debugStateVariables) . status
  WSIGetWatches -> fmap (f $ WSOWatches . debugStateWatches) . status
  WSIAddWatches w -> fmap (const Nothing) . addWatches w
  WSIRemoveWatches w -> fmap (const Nothing) . removeWatches w
  WSIClearWatches -> fmap (const Nothing) . removeWatches []
  where f g m = case m of
          Running -> Nothing
          Paused dbgst -> Just $ g dbgst

wsUpdateThread :: WS.Connection -> DebugSettings -> IO ()
wsUpdateThread conn DebugSettings{..} = do
  cur <- readTVarIO current
  go cur
  where go cur = do
          newCur <- atomically $ do
            cur' <- readTVar current
            if cur == cur'
              then retrySTM
              else pure cur'
          WS.sendBinaryData conn . encode . WSOStatus $ case newCur of
            Nothing -> Running
            Just ds -> Paused ds
          go newCur

-- it's ok to spawn an update thread per connection, since we're currently only supporting one WS connection at a time
talk :: WS.Connection -> DebugSettings -> IO ()
talk conn dSettings = race_ (wsUpdateThread conn dSettings) . forever $ do
  eMsg <- eitherDecode <$> WS.receiveData conn
  case eMsg of
    Left e -> broadcast e conn
    Right r -> do
      dStatus <- wsDebuggerController r dSettings
      for_ dStatus $ WS.sendBinaryData conn . encode

broadcast :: String -> WS.Connection -> IO ()
broadcast message conn = do
  putStrLn message
  WS.sendTextData conn $ T.pack message

wsDebugger :: Int -> DebugSettings -> IO ()
wsDebugger port dSettings = do
  putStrLn $ "Starting WS Debugger on port " ++ show port
  inUse <- newTVarIO False
  WS.runServer "172.20.20.7" port $ wsDebuggerServer inUse dSettings