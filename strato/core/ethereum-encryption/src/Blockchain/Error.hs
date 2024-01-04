module Blockchain.Error where

import System.Exit
import System.IO
import System.IO.Unsafe
import System.Posix.Process

--Same as `error`, but works in threads also.
error' :: String -> a
error' x = unsafePerformIO $ do
  hPutStrLn stderr x
  _ <- exitImmediately $ ExitFailure (-1)
  return undefined
