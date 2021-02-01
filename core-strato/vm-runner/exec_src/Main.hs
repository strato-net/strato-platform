{-# LANGUAGE DataKinds         #-} -- DEBUGGING
{-# LANGUAGE LambdaCase        #-} -- DEBUGGING
{-# LANGUAGE RecordWildCards   #-} -- DEBUGGING
{-# LANGUAGE TypeOperators     #-} -- DEBUGGING
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

import           Control.Monad
import           Control.Concurrent.Async             as Async
import           Network.Wai.Middleware.Prometheus
import           Network.Wai.Handler.Warp
import           HFlags

import           BlockApps.Init
import           Blockchain.Output
import           Blockchain.VMOptions() -- HFlags
import           Executable.EthereumVM
import           Executable.EVMFlags() -- HFlags

-- DEBUGGING
import GHC.Generics
import Servant
import Control.Exception hiding (Handler)
import Control.Monad.IO.Class
import Data.Aeson
import qualified Data.Set as S
import qualified Data.Text as T
import UnliftIO.STM
import Blockchain.VMContext
import Blockchain.VMOptions
import qualified Network.WebSockets as WS

data DebuggerStatus = Running
                    | Paused {
                      breakpoint :: Breakpoint
                    , callstack :: [String]
                    } deriving (Eq, Ord, Show, Generic, ToJSON, FromJSON)

status :: MonadIO m => DebugSettings -> m DebuggerStatus
status dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    ~(isRunning, mCurrent) <- atomically $ (,) <$> readTVar running <*> readTVar current
    if isRunning
      then pure Running
      else case mCurrent of
        Nothing -> pure Running
        Just (b, cs) -> pure $ Paused b cs

pause :: MonadIO m => DebugSettings -> m DebuggerStatus
pause dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    mCurrent <- atomically $ do
      writeTVar running False
      readTVar current
    case mCurrent of
      Nothing -> pure Running
      Just (b, cs) -> pure $ Paused b cs

resume :: MonadIO m => DebugSettings -> m DebuggerStatus
resume dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    atomically $ do
      writeTVar running True
      writeTVar current Nothing
    pure Running

addBreakpoint :: MonadIO m => Breakpoint -> DebugSettings -> m DebuggerStatus
addBreakpoint bPoint dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    ~(isRunning, mCurrent) <- atomically $ do
      modifyTVar breakpoints $ S.insert bPoint
      (,) <$> readTVar running <*> readTVar current
    if isRunning
      then pure Running
      else case mCurrent of
        Nothing -> pure Running
        Just (b, cs) -> pure $ Paused b cs

removeBreakpoint :: MonadIO m => Breakpoint -> DebugSettings -> m DebuggerStatus
removeBreakpoint bPoint dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    ~(isRunning, mCurrent) <- atomically $ do
      modifyTVar breakpoints $ S.delete bPoint
      (,) <$> readTVar running <*> readTVar current
    if isRunning
      then pure Running
      else case mCurrent of
        Nothing -> pure Running
        Just (b, cs) -> pure $ Paused b cs

type RestDebuggerAPI = GetStatus
                  :<|> PutPause
                  :<|> PutResume
                  :<|> PutBreakpoint
                  :<|> DeleteBreakpoint

type GetStatus = "status" :> Get '[JSON] DebuggerStatus
type PutPause = "pause" :> Put '[JSON] DebuggerStatus
type PutResume = "resume" :> Put '[JSON] DebuggerStatus
type PutBreakpoint = "breakpoint" :> ReqBody '[JSON] Breakpoint :> Put '[JSON] DebuggerStatus
type DeleteBreakpoint = "breakpoint" :> ReqBody '[JSON] Breakpoint :> Delete '[JSON] DebuggerStatus

restDebuggerAPI :: Proxy RestDebuggerAPI
restDebuggerAPI = Proxy

getStatus :: DebugSettings -> Handler DebuggerStatus
getStatus = status

putPause :: DebugSettings -> Handler DebuggerStatus
putPause = pause

putResume :: DebugSettings -> Handler DebuggerStatus
putResume = resume

putBreakpoint :: DebugSettings -> Breakpoint -> Handler DebuggerStatus
putBreakpoint = flip addBreakpoint

deleteBreakpoint :: DebugSettings -> Breakpoint -> Handler DebuggerStatus
deleteBreakpoint = flip removeBreakpoint

restDebuggerServer :: DebugSettings -> Server RestDebuggerAPI
restDebuggerServer dSettings =
       getStatus dSettings
  :<|> putPause dSettings
  :<|> putResume dSettings
  :<|> putBreakpoint dSettings
  :<|> deleteBreakpoint dSettings

restDebugger :: DebugSettings -> Application
restDebugger dSettings = serve restDebuggerAPI (restDebuggerServer dSettings)

data WSDebuggerInput = Status
                     | Pause
                     | Resume
                     | AddBreakpoint Breakpoint
                     | RemoveBreakpoint Breakpoint
                     | StepIn
                     | StepOver
                     | StepOut
                     deriving (Eq, Show, Generic, ToJSON, FromJSON)

wsDebugger :: DebugSettings -> IO ()
wsDebugger dSettings = do
  putStrLn $ "Starting WS Debugger on port " ++ show flags_debugPort
  inUse <- newTVarIO False
  WS.runServer "172.20.20.7" flags_debugPort $ wsDebuggerServer inUse dSettings

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
          disconnect = atomically $ writeTVar inUse False

wsDebuggerController :: MonadIO m => WSDebuggerInput -> DebugSettings -> m DebuggerStatus
wsDebuggerController = \case
  Status -> status
  Pause -> pause
  Resume -> resume
  AddBreakpoint b -> addBreakpoint b
  RemoveBreakpoint b -> removeBreakpoint b
  -- TODO
  StepIn -> status
  StepOver -> status
  StepOut -> status

talk :: WS.Connection -> DebugSettings -> IO ()
talk conn dSettings = forever $ do
  eMsg <- eitherDecode <$> WS.receiveData conn
  case eMsg of
    Left e -> broadcast e conn
    Right r -> do
      dStatus <- wsDebuggerController r dSettings
      WS.sendBinaryData conn $ encode dStatus

broadcast :: String -> WS.Connection -> IO ()
broadcast message conn = do
  putStrLn message
  WS.sendTextData conn $ T.pack message

main :: IO ()
main = do
  blockappsInit "vm_main"
  void $ $initHFlags "Ethereum VM"
  let metricsRunner = run 8000 metricsApp
  ~(debugSettings, runCmd) <-
    if not flags_debugSolidVM
      then pure (DebuggingDisabled, metricsRunner)
      else do
        dSettings <- atomically newDebugSettings
        let debuggerRunner = if flags_wsDebug
                               then wsDebugger dSettings
                               else run flags_debugPort (restDebugger dSettings)
            runner = race_ metricsRunner debuggerRunner
        pure (dSettings, runner)
  race_ (runLoggingT $ ethereumVM debugSettings) runCmd