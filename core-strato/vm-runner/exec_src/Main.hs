{-# LANGUAGE DataKinds         #-} -- DEBUGGING
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
import Data.Aeson
import qualified Data.Set as S
import UnliftIO.STM
import Blockchain.VMContext
import Blockchain.VMOptions

type DebuggerAPI = GetStatus
              :<|> PutPause
              :<|> PutResume
              :<|> PutBreakpoint
              :<|> DeleteBreakpoint

data DebuggerStatus = Running
                    | Paused {
                      breakpoint :: Breakpoint
                    , callstack :: [String]
                    } deriving (Eq, Ord, Show, Generic, ToJSON, FromJSON)

type GetStatus = "status" :> Get '[JSON] DebuggerStatus
type PutPause = "pause" :> Put '[JSON] DebuggerStatus
type PutResume = "resume" :> Put '[JSON] DebuggerStatus
type PutBreakpoint = "breakpoint" :> ReqBody '[JSON] Breakpoint :> Put '[JSON] DebuggerStatus
type DeleteBreakpoint = "breakpoint" :> ReqBody '[JSON] Breakpoint :> Delete '[JSON] DebuggerStatus

debuggerAPI :: Proxy DebuggerAPI
debuggerAPI = Proxy

getStatus :: DebugSettings -> Handler DebuggerStatus
getStatus dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    ~(isRunning, mCurrent) <- atomically $ (,) <$> readTVar running <*> readTVar current
    if isRunning
      then pure Running
      else case mCurrent of
        Nothing -> pure Running
        Just (b, cs) -> pure $ Paused b cs

putPause :: DebugSettings -> Handler DebuggerStatus
putPause dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    mCurrent <- atomically $ do
      writeTVar running False
      readTVar current
    case mCurrent of
      Nothing -> pure Running
      Just (b, cs) -> pure $ Paused b cs

putResume :: DebugSettings -> Handler DebuggerStatus
putResume dSettings = case dSettings of
  DebuggingDisabled -> pure Running
  DebugSettings{..} -> do
    atomically $ do
      writeTVar running True
      writeTVar current Nothing
    pure Running

putBreakpoint :: DebugSettings -> Breakpoint -> Handler DebuggerStatus
putBreakpoint dSettings bPoint = case dSettings of
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

deleteBreakpoint :: DebugSettings -> Breakpoint -> Handler DebuggerStatus
deleteBreakpoint dSettings bPoint = case dSettings of
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

debugger :: DebugSettings -> Server DebuggerAPI
debugger dSettings = getStatus dSettings
                :<|> putPause dSettings
                :<|> putResume dSettings
                :<|> putBreakpoint dSettings
                :<|> deleteBreakpoint dSettings

runDebugger :: DebugSettings -> Application
runDebugger dSettings = serve debuggerAPI (debugger dSettings)

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
        let debuggerRunner = run flags_debugPort
                                 (runDebugger dSettings)
            runner = race_ metricsRunner debuggerRunner
        pure (dSettings, runner)
  race_ (runLoggingT $ ethereumVM debugSettings) runCmd