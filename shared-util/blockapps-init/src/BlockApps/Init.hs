module BlockApps.Init ( blockappsInit ) where

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
  putStrLn "attempting to self exec"
  cmd <- getProgName
  args <- getArgs
  putStrLn $ "caught sig-hup; self-reexec: " ++ intercalate " " (cmd:args)
  hFlush stdout
  cmdC <- newCString cmd
  argsC <- mapM newCString args
  withArray argsC $ \argsPC ->
    void $ c_execvp cmdC argsPC

blockappsInit :: Text -> IO ()
blockappsInit self = do
  initializeHealthChecks self

  -- TODO: exec self
  void $ installHandler sigHUP (Catch selfExec) Nothing
