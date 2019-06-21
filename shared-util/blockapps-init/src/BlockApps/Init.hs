module BlockApps.Init ( blockappsInit ) where

import Control.Concurrent
import Control.Monad
import Data.List (intercalate)
import Data.Text hiding (intercalate)
import Foreign hiding (void)
import Foreign.C
import System.Environment
import System.IO
import System.Posix.Signals

import Blockapps.Crossmon

foreign import ccall unsafe "execvp"
  c_execvp :: CString -> Ptr CString -> IO CInt

selfExec :: IO ()
selfExec = do
  tid <- myThreadId
  putStrLn $ "attempting to self exec " ++ show tid
  cmd <- getProgName
  args <- getArgs
  putStrLn $ "caught sig-hup; self-reexec: " ++ intercalate " " (cmd:args)
  hFlush stdout
  cmdC <- newCString cmd
  argsC <- mapM newCString args
  withArray0 nullPtr (cmdC:argsC) $ \argsPC -> do
    void $ c_execvp cmdC argsPC
    throwErrno "unable to exec"

blockappsInit :: Text -> IO ()
blockappsInit self = do
  tid <- myThreadId
  putStrLn $ "blockapps-init for " ++ show tid
  initializeHealthChecks self

  -- TODO: exec self
  void $ installHandler sigHUP (Catch selfExec) Nothing
