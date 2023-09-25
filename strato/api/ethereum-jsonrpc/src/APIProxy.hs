module APIProxy
  ( call,
  )
where

import Control.Monad.IO.Class
import qualified Data.ByteString.Lazy.Char8 as BLC
import Network.HTTP.Client

apiBaseUrl :: String
apiBaseUrl = "http://localhost:3000/eth/v1.2/"

call :: String -> IO String
call command = do
  manager <- liftIO $ newManager defaultManagerSettings
  request <- liftIO $ parseRequest $ apiBaseUrl ++ command
  response <- liftIO $ httpLbs request manager
  return $ BLC.unpack $ responseBody response
