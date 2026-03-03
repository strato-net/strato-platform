module APIProxy
  ( call,
  )
where

import Control.Monad.IO.Class
import qualified Data.ByteString.Lazy.Char8 as BLC
import Network.HTTP.Client
import System.Environment (lookupEnv)
import Data.Maybe (fromMaybe)
import System.IO.Unsafe (unsafePerformIO)

{-# NOINLINE apiBaseUrl #-}
apiBaseUrl :: String
apiBaseUrl = unsafePerformIO $ do
  host <- fromMaybe "localhost" <$> lookupEnv "STRATO_API_HOST"
  port <- fromMaybe "3000" <$> lookupEnv "STRATO_API_PORT"
  return $ "http://" ++ host ++ ":" ++ port ++ "/eth/v1.2/"

call :: String -> IO String
call command = do
  manager <- liftIO $ newManager defaultManagerSettings
  request <- liftIO $ parseRequest $ apiBaseUrl ++ command
  response <- liftIO $ httpLbs request manager
  return $ BLC.unpack $ responseBody response
