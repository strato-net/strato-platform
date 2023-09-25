module Clockwork where

import Control.Monad.IO.Class
import Data.Int

foreign import ccall unsafe "before" cwBefore :: IO ()

foreign import ccall unsafe "after" cwAfter :: IO Int64

cwPrintTime :: MonadIO m => m a -> m a
cwPrintTime f = do
  liftIO cwBefore
  result <- f
  v <- liftIO cwAfter
  liftIO $ putStrLn $ "Clockwork! " ++ show v
  return result
