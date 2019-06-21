module BlockApps.Init ( blockappsInit ) where

import Control.Monad
import Data.Text
import System.Posix.Signals

import Blockapps.Crossmon

blockappsInit :: Text -> IO ()
blockappsInit self = do
  initializeHealthChecks self

  -- TODO: exec self
  void $ installHandler sigHUP (Catch (print (self, "sighup received!"))) Nothing
