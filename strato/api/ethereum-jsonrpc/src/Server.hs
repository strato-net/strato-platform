{-# LANGUAGE OverloadedStrings #-}

module Server
  ( startServer,
  )
where

--import Control.Monad.IO.Class
import Blaze.ByteString.Builder (copyByteString)
import qualified Data.ByteString.Lazy as BL
import Network.HTTP.Types (status200)
import Network.Wai
import Network.Wai.Handler.Warp
import Control.Exception (catch, SomeException)
import qualified Data.Aeson as JSON
--import Data.Monoid

import RPC

startServer :: IO ()
startServer = do
  let port = 8546
  putStrLn $ "Listening on port " ++ show port
  run port app

app :: Request -> (Response -> IO ResponseReceived) -> IO ResponseReceived
app req respond = do
  theRequest <- getRequestBodyChunk req
  putStrLn $ show (remoteHost req) ++ " >>> " ++ show theRequest

  response <- catch
    (doRPC $ BL.fromStrict theRequest)
    (\e -> do
      putStrLn $ "Error processing request: " ++ show (e :: SomeException)
      let errObj = JSON.object
            [ "jsonrpc" JSON..= ("2.0" :: String)
            , "id" JSON..= JSON.Null
            , "error" JSON..= JSON.object
                [ "code" JSON..= (-32603 :: Int)
                , "message" JSON..= ("Internal error" :: String)
                ]
            ]
      return $ JSON.encode errObj)

  respond $
    responseBuilder status200 [("Content-Type", "text/plain")] $ copyByteString $ BL.toStrict response
