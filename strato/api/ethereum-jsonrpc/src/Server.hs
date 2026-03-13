{-# LANGUAGE OverloadedStrings #-}

module Server
  ( startServer,
  )
where

--import Control.Monad.IO.Class
import Blaze.ByteString.Builder (copyByteString)
import Blockchain.EthConf (runKafkaMConfigured)
import Control.Monad.Composable.Kafka (createTopicAndWait)
import qualified Data.ByteString.Lazy as BL
import Network.HTTP.Types (status200)
import Network.Wai
import Network.Wai.Handler.Warp
--import Data.Monoid

import RPC

startServer :: IO ()
startServer = do
  runKafkaMConfigured "ethereum-jsonrpc" $ createTopicAndWait "jsonrpcresponse"
  let port = 8546
  putStrLn $ "Listening on port " ++ show port
  run port app

app :: Request -> (Response -> IO ResponseReceived) -> IO ResponseReceived
app req respond = do
  theRequest <- getRequestBodyChunk req
  putStrLn $ show (remoteHost req) ++ " >>> " ++ show theRequest

  response <- doRPC $ BL.fromStrict theRequest

  respond $
    responseBuilder status200 [("Content-Type", "text/plain")] $ copyByteString $ BL.toStrict response
