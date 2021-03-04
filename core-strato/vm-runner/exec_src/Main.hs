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
                    | Paused DebugState
                    deriving (Eq, Ord, Show, Generic, ToJSON, FromJSON)

status :: MonadIO m => DebugSettings -> m DebuggerStatus
status dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    ~(currentOperation, mCurrent) <- atomically $ (,) <$> readTVar operation <*> readTVar current
    if currentOperation == Run
      then pure Running
      else case mCurrent of
        Nothing -> pure Running
        Just dbgst -> pure $ Paused dbgst

pause :: MonadIO m => DebugSettings -> m DebuggerStatus
pause dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    mCurrent <- atomically $ do
      writeTVar operation Pause
      readTVar current
    case mCurrent of
      Nothing -> pure Running
      Just dbgst -> pure $ Paused dbgst

resume :: MonadIO m => DebugSettings -> m DebuggerStatus
resume dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    atomically $ do
      writeTVar operation Run
      writeTVar current Nothing
    pure Running

stepIn :: MonadIO m => DebugSettings -> m DebuggerStatus
stepIn dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    mCurrent <- atomically $ do
      writeTVar operation StepIn
      readTVar current
    case mCurrent of
      Nothing -> pure Running
      Just dbgst -> pure $ Paused dbgst

stepOver :: MonadIO m => DebugSettings -> m DebuggerStatus
stepOver dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    mCurrent <- atomically $ do
      mCurrent <- readTVar current
      case mCurrent of
        Nothing -> writeTVar operation Run
        Just (DebugState _ cStack _ _) -> writeTVar operation (StepOver $ length cStack)
      pure mCurrent
    case mCurrent of
      Nothing -> pure Running
      Just dbgst-> pure $ Paused dbgst

stepOut :: MonadIO m => DebugSettings -> m DebuggerStatus
stepOut dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    mCurrent <- atomically $ do
      mCurrent <- readTVar current
      case mCurrent of
        Nothing -> writeTVar operation Run
        Just (DebugState _ cStack _ _) -> writeTVar operation (StepOut $ length cStack)
      pure mCurrent
    case mCurrent of
      Nothing -> pure Running
      Just dbgst -> pure $ Paused dbgst

getBreakpoints :: MonadIO m => DebugSettings -> m [Breakpoint]
getBreakpoints dSettings = case dSettings of
  DebuggingDisabled -> pure []
  DebugSettings{..} -> fmap S.toList . atomically $ readTVar breakpoints

addBreakpoints :: MonadIO m => [Breakpoint] -> DebugSettings -> m DebuggerStatus
addBreakpoints bPoints dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    ~(currentOperation, mCurrent) <- atomically $ do
      modifyTVar breakpoints $ \bps -> foldr S.insert bps bPoints
      (,) <$> readTVar operation <*> readTVar current
    if currentOperation == Run
      then pure Running
      else case mCurrent of
        Nothing -> pure Running
        Just dbgst -> pure $ Paused dbgst

removeBreakpoints :: MonadIO m => [Breakpoint] -> DebugSettings -> m DebuggerStatus
removeBreakpoints bPoints dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    ~(currentOperation, mCurrent) <- atomically $ do
      modifyTVar breakpoints $ \bps -> case bPoints of
        [] -> S.empty
        bPoints' -> foldr S.delete bps bPoints'
      (,) <$> readTVar operation <*> readTVar current
    if currentOperation == Run
      then pure Running
      else case mCurrent of
        Nothing -> pure Running
        Just dbgst -> pure $ Paused dbgst

type RestDebuggerAPI = GetStatus
                  :<|> PutPause
                  :<|> PutResume
                  :<|> GetBreakpoints
                  :<|> PutBreakpoints
                  :<|> DeleteBreakpoints

type GetStatus = "status" :> Get '[JSON] DebuggerStatus
type PutPause = "pause" :> Put '[JSON] DebuggerStatus
type PutResume = "resume" :> Put '[JSON] DebuggerStatus
type GetBreakpoints = "breakpoints" :> Get '[JSON] [Breakpoint]
type PutBreakpoints = "breakpoints" :> ReqBody '[JSON] [Breakpoint] :> Put '[JSON] DebuggerStatus
type DeleteBreakpoints = "breakpoints" :> ReqBody '[JSON] [Breakpoint] :> Delete '[JSON] DebuggerStatus

restDebuggerAPI :: Proxy RestDebuggerAPI
restDebuggerAPI = Proxy

getStatus :: DebugSettings -> Handler DebuggerStatus
getStatus = status

putPause :: DebugSettings -> Handler DebuggerStatus
putPause = pause

putResume :: DebugSettings -> Handler DebuggerStatus
putResume = resume

getBreakpointsHandler :: DebugSettings -> Handler [Breakpoint]
getBreakpointsHandler = getBreakpoints

putBreakpoints :: DebugSettings -> [Breakpoint] -> Handler DebuggerStatus
putBreakpoints = flip addBreakpoints

deleteBreakpoints :: DebugSettings -> [Breakpoint] -> Handler DebuggerStatus
deleteBreakpoints = flip removeBreakpoints

restDebuggerServer :: DebugSettings -> Server RestDebuggerAPI
restDebuggerServer dSettings =
       getStatus dSettings
  :<|> putPause dSettings
  :<|> putResume dSettings
  :<|> getBreakpointsHandler dSettings
  :<|> putBreakpoints dSettings
  :<|> deleteBreakpoints dSettings

restDebugger :: DebugSettings -> Application
restDebugger dSettings = serve restDebuggerAPI (restDebuggerServer dSettings)

data WSDebuggerInput = WSStatus
                     | WSPause
                     | WSResume
                     | WSGetBreakpoints
                     | WSAddBreakpoints [Breakpoint]
                     | WSRemoveBreakpoints [Breakpoint]
                     | WSStepIn
                     | WSStepOver
                     | WSStepOut
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

wsDebuggerController :: MonadIO m => WSDebuggerInput -> DebugSettings -> m (Either [Breakpoint] DebuggerStatus)
wsDebuggerController = \case
  WSStatus -> fmap Right . status
  WSPause -> fmap Right . pause
  WSResume -> fmap Right . resume
  WSGetBreakpoints -> fmap Left . getBreakpoints
  WSAddBreakpoints b -> fmap Right . addBreakpoints b
  WSRemoveBreakpoints b -> fmap Right . removeBreakpoints b
  WSStepIn -> fmap Right . stepIn
  WSStepOver -> fmap Right . stepOver
  WSStepOut -> fmap Right . stepOut

talk :: WS.Connection -> DebugSettings -> IO ()
talk conn dSettings = forever $ do
  eMsg <- eitherDecode <$> WS.receiveData conn
  case eMsg of
    Left e -> broadcast e conn
    Right r -> do
      dStatus <- wsDebuggerController r dSettings
      WS.sendBinaryData conn $ either encode encode dStatus

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