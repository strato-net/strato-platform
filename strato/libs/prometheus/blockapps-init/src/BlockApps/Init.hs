{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.Init (blockappsInit) where

import BlockApps.Crossmon
import BlockApps.Logging (LoggingT)
import Control.Concurrent
import Control.Monad
import Control.Monad.Trans.Resource (ResourceT)
import Data.List (intercalate)
import Data.Text hiding (intercalate)
import Foreign hiding (void)
import Foreign.C
import GHC.Environment
import Prometheus
import System.IO
import System.Posix.Signals

instance (MonadMonitor m) => MonadMonitor (ResourceT m)
instance (MonadMonitor m) => MonadMonitor (LoggingT m)

foreign import ccall unsafe "execvp"
  c_execvp :: CString -> Ptr CString -> IO CInt

selfExec :: IO ()
selfExec = do
  tid <- myThreadId
  putStrLn $ "attempting to self exec " ++ show tid
  argv@(cmd : _) <- getFullArgs
  putStrLn $ "caught sig-hup; self-reexec: " ++ intercalate " " argv
  hFlush stdout
  cmdC <- newCString cmd
  argvC <- mapM newCString argv
  withArray0 nullPtr argvC $ \argvPC -> do
    void $ c_execvp cmdC argvPC
    throwErrno "unable to exec"

blockappsInit :: Text -> IO ()
blockappsInit self = do
  --Try and initialize a centralized location for all manager information
  --Try and initialize a centralized location for all of the OAuth information (usually get from the getting-started script)
  --Try and initialize normal exchange token
  --Try and initialize a normal refresh token
  --Refresh token doesn't exist if there hasn't been an update, initialize when it is first created
  --try to initialize the accessToken space
  -- accessToken <- case (tryReadTMVar accessToken) of
  --   Nothing -> newTMVar accessToken ()
  --   _ -> swapTMVar accessToken (refreshAccessToken manager oauthInfo ((readTMVar accessToken) ^. refreshToken))
  tid <- myThreadId
  putStrLn $ "blockapps-init for " ++ show tid
  initializeHealthChecks self

  -- TODO: exec self
  void $ installHandler sigHUP (Catch selfExec) Nothing

-- --VaultProxy
-- vaultSetup :: m => Manager -> OAuth2 -> ExchangeToken -> m OAuth2Token
-- vaultSetup manager oauthInfo exchangeToken = do
--   case (tryReadTMVar accessToken) of

-- vaultUpdate :: m => Manager -> OAuth2 -> RefreshToken -> m OAuth2Token
-- vaultUpdate manager oauthInfo refreshToken = swapTMVar accessToken (refreshAccessToken manager oauthInfo refreshToken)
