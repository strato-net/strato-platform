module BlockApps.Init ( blockappsInit ) where

import Control.Concurrent
import Control.Monad
import Data.List (intercalate)
import Data.Text hiding (intercalate)
import Foreign hiding (void)
import Foreign.C
import GHC.Environment
import System.IO
import System.Posix.Signals

import Blockapps.Crossmon

foreign import ccall unsafe "execvp"
  c_execvp :: CString -> Ptr CString -> IO CInt

selfExec :: IO ()
selfExec = do
  tid <- myThreadId
  putStrLn $ "attempting to self exec " ++ show tid
  argv@(cmd:_) <- getFullArgs
  putStrLn $ "caught sig-hup; self-reexec: " ++ intercalate " " argv
  hFlush stdout
  cmdC <- newCString cmd
  argvC <- mapM newCString argv
  withArray0 nullPtr argvC $ \argvPC -> do
    void $ c_execvp cmdC argvPC
    throwErrno "unable to exec"

blockappsInit :: Text -> IO ()
blockappsInit self = do
  tid <- myThreadId
  putStrLn $ "blockapps-init for " ++ show tid
  initializeHealthChecks self

  -- TODO: exec self
  void $ installHandler sigHUP (Catch selfExec) Nothing
