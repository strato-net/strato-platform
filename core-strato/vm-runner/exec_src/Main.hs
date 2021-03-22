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
import qualified Data.Map.Strict as M
import qualified Data.Set as S
import qualified Data.Text as T
import Data.Foldable (for_)
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
    mCurrent <- atomically $ readTVar current
    case mCurrent of
      Nothing -> pure Running
      Just dbgst -> pure $ Paused dbgst

pause :: MonadIO m => DebugSettings -> m DebuggerStatus
pause dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    void . atomically $ do
      writeTVar operation Pause
      readTVar current
    status dSettings

resume :: MonadIO m => DebugSettings -> m DebuggerStatus
resume dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    void . atomically $ do
      writeTVar operation Run
      writeTVar current Nothing
    status dSettings

stepIn :: MonadIO m => DebugSettings -> m DebuggerStatus
stepIn dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    void . atomically $ writeTVar operation StepIn
    status dSettings

stepOver :: MonadIO m => DebugSettings -> m DebuggerStatus
stepOver dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    void . atomically $ do
      mCurrent <- readTVar current
      case mCurrent of
        Nothing -> writeTVar operation Run
        Just (DebugState _ cStack _ _) -> writeTVar operation (StepOver $ length cStack)
    status dSettings

stepOut :: MonadIO m => DebugSettings -> m DebuggerStatus
stepOut dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    void . atomically $ do
      mCurrent <- readTVar current
      case mCurrent of
        Nothing -> writeTVar operation Run
        Just (DebugState _ cStack _ _) -> writeTVar operation (StepOut $ length cStack)
    status dSettings

getBreakpoints :: MonadIO m => DebugSettings -> m [Breakpoint]
getBreakpoints dSettings = case dSettings of
  DebuggingDisabled -> pure []
  DebugSettings{..} -> fmap S.toList . atomically $ readTVar breakpoints

addBreakpoints :: MonadIO m => [Breakpoint] -> DebugSettings -> m DebuggerStatus
addBreakpoints bPoints dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    void . atomically $ do
      modifyTVar breakpoints $ \bps -> foldr S.insert bps bPoints
    status dSettings

removeBreakpoints :: MonadIO m => [Breakpoint] -> DebugSettings -> m DebuggerStatus
removeBreakpoints bPoints dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    void . atomically $ do
      modifyTVar breakpoints $ \bps -> case bPoints of
        [] -> S.empty
        bPoints' -> foldr S.delete bps bPoints'
    status dSettings

removeBreakpointsPath :: MonadIO m => [T.Text] -> DebugSettings -> m DebuggerStatus
removeBreakpointsPath paths dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    void . atomically $ do
      modifyTVar breakpoints $ \bps ->
        let pathsSet = S.fromList paths
            bpf ps (UnconditionalBP loc) = not $ breakpointFile loc `S.member` ps
            bpf ps (ConditionalBP loc _) = not $ breakpointFile loc `S.member` ps
            bpf _ _ = True
         in S.filter (bpf pathsSet) bps
    status dSettings

addWatches :: MonadIO m => [T.Text] -> DebugSettings -> m DebuggerStatus
addWatches watches dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    void . atomically $ do
      modifyTVar watchExpressions $ \wes -> foldr S.insert wes watches
    status dSettings

removeWatches :: MonadIO m => [T.Text] -> DebugSettings -> m DebuggerStatus
removeWatches watches dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    void . atomically $ do
      modifyTVar watchExpressions $ \wes -> case watches of
        [] -> S.empty
        watches' -> foldr S.delete wes watches'
    status dSettings

type RestDebuggerAPI = GetStatus
                  :<|> PutPause
                  :<|> PutResume
                  :<|> GetBreakpoints
                  :<|> PutBreakpoints
                  :<|> DeleteBreakpoints
                  :<|> DeleteBreakpointsPath
                  :<|> PostStepIn
                  :<|> PostStepOver
                  :<|> PostStepOut
                  :<|> GetStackTrace
                  :<|> GetVariables
                  :<|> GetWatches
                  :<|> PutWatches
                  :<|> DeleteWatches

type GetStatus = "status" :> Get '[JSON] DebuggerStatus
type PutPause = "pause" :> Put '[JSON] DebuggerStatus
type PutResume = "resume" :> Put '[JSON] DebuggerStatus
type GetBreakpoints = "breakpoints" :> Get '[JSON] [Breakpoint]
type PutBreakpoints = "breakpoints" :> ReqBody '[JSON] [Breakpoint] :> Put '[JSON] DebuggerStatus
type DeleteBreakpoints = "breakpoints" :> ReqBody '[JSON] [Breakpoint] :> Delete '[JSON] DebuggerStatus
type DeleteBreakpointsPath = "breakpoints" :> Capture "file" T.Text :> Delete '[JSON] DebuggerStatus
type PostStepIn = "step-in" :> Post '[JSON] DebuggerStatus
type PostStepOver = "step-over" :> Post '[JSON] DebuggerStatus
type PostStepOut = "step-out" :> Post '[JSON] DebuggerStatus
type GetStackTrace = "stack-trace" :> Get '[JSON] [BreakpointLoc]
type GetVariables = "variables" :> Get '[JSON] (M.Map T.Text T.Text)
type GetWatches = "watches" :> Get '[JSON] (M.Map T.Text T.Text)
type PutWatches = "watches" :> ReqBody '[JSON] [T.Text] :> Put '[JSON] DebuggerStatus
type DeleteWatches = "watches" :> ReqBody '[JSON] [T.Text] :> Delete '[JSON] DebuggerStatus

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

deleteBreakpointsPath :: DebugSettings -> T.Text -> Handler DebuggerStatus
deleteBreakpointsPath = flip $ removeBreakpointsPath . (:[])

postStepIn :: DebugSettings -> Handler DebuggerStatus
postStepIn = stepIn

postStepOver :: DebugSettings -> Handler DebuggerStatus
postStepOver = stepOver

postStepOut :: DebugSettings -> Handler DebuggerStatus
postStepOut = stepOut

getStackTrace :: DebugSettings -> Handler [BreakpointLoc]
getStackTrace = status >=> \case
  Running -> pure []
  Paused DebugState{..} -> pure debugStateCallStack

getVariables :: DebugSettings -> Handler (M.Map T.Text T.Text)
getVariables = status >=> \case
  Running -> pure M.empty
  Paused DebugState{..} -> pure debugStateVariables

getWatches :: DebugSettings -> Handler (M.Map T.Text T.Text)
getWatches = status >=> \case
  Running -> pure M.empty
  Paused DebugState{..} -> pure debugStateWatches

putWatches :: DebugSettings -> [T.Text] -> Handler DebuggerStatus
putWatches = flip addWatches

deleteWatches :: DebugSettings -> [T.Text] -> Handler DebuggerStatus
deleteWatches = flip removeWatches

restDebuggerServer :: DebugSettings -> Server RestDebuggerAPI
restDebuggerServer dSettings =
       getStatus dSettings
  :<|> putPause dSettings
  :<|> putResume dSettings
  :<|> getBreakpointsHandler dSettings
  :<|> putBreakpoints dSettings
  :<|> deleteBreakpoints dSettings
  :<|> deleteBreakpointsPath dSettings
  :<|> postStepIn dSettings
  :<|> postStepOver dSettings
  :<|> postStepOut dSettings
  :<|> getStackTrace dSettings
  :<|> getVariables dSettings
  :<|> getWatches dSettings
  :<|> putWatches dSettings
  :<|> deleteWatches dSettings

restDebugger :: DebugSettings -> Application
restDebugger dSettings = serve restDebuggerAPI (restDebuggerServer dSettings)

data WSDebuggerInput = WSIStatus
                     | WSIPause
                     | WSIResume
                     | WSIGetBreakpoints
                     | WSIAddBreakpoints [Breakpoint]
                     | WSIRemoveBreakpoints [Breakpoint]
                     | WSIClearBreakpoints
                     | WSIClearBreakpointsPath [T.Text]
                     | WSIStepIn
                     | WSIStepOver
                     | WSIStepOut
                     | WSIGetStackTrace
                     | WSIGetVariables
                     | WSIGetWatches
                     | WSIAddWatches [T.Text]
                     | WSIRemoveWatches [T.Text]
                     | WSIClearWatches
                     deriving (Eq, Show, Generic, ToJSON, FromJSON)

data WSDebuggerOutput = WSOStatus DebuggerStatus
                      | WSOStackTrace [BreakpointLoc]
                      | WSOVariables (M.Map T.Text T.Text)
                      | WSOWatches (M.Map T.Text T.Text)
                      | WSOBreakpoints [Breakpoint]
                      deriving (Eq, Show, Generic, ToJSON, FromJSON)

wsDebugger :: DebugSettings -> IO ()
wsDebugger dSettings = do
  putStrLn $ "Starting WS Debugger on port " ++ show flags_debugWSPort
  inUse <- newTVarIO False
  WS.runServer "172.20.20.7" flags_debugWSPort $ wsDebuggerServer inUse dSettings

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
wsUpdateThread conn = \case
  DebuggingDisabled -> pure ()
  DebugSettings{..} -> do
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
        let debuggerRunner =
              let rest = run flags_debugPort (restDebugger dSettings)
               in if flags_wsDebug
                    then race_ rest $ wsDebugger dSettings
                    else rest
            runner = race_ metricsRunner debuggerRunner
        pure (dSettings, runner)
  race_ (runLoggingT $ ethereumVM debugSettings) runCmd