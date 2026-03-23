{-# LANGUAGE OverloadedStrings #-}

module Server
  ( startServer,
  )
where

import Blaze.ByteString.Builder (copyByteString)
import qualified Data.ByteString as BS
import Blockchain.EthConf (runKafkaMConfigured)
import Control.Monad.Composable.Kafka (createTopicAndWait)
import qualified Data.ByteString.Lazy as BL
import qualified Data.CaseInsensitive as CI
import Network.HTTP.Types (status200, status204)
import Network.Wai
import Network.Wai.Handler.Warp

import RPC

startServer :: IO ()
startServer = do
  let port = 8545
  runKafkaMConfigured "ethereum-jsonrpc" $ createTopicAndWait "jsonrpcresponse"
  putStrLn $ "Listening on port " ++ show port
  run port app

corsHeaders :: [(CI.CI BS.ByteString, BS.ByteString)]
corsHeaders =
  [ ("Access-Control-Allow-Origin", "*")
  , ("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
  , ("Access-Control-Allow-Headers", "Content-Type")
  , ("Content-Type", "application/json")
  ]

app :: Request -> (Response -> IO ResponseReceived) -> IO ResponseReceived
app req respond
  | requestMethod req == "OPTIONS" = 
      respond $ responseLBS status204 corsHeaders ""
  | otherwise = do
      body <- strictRequestBody req
      putStrLn $ show (remoteHost req) ++ " >>> " ++ show body

      response <- doRPC body

      putStrLn $ show (remoteHost req) ++ " <<< " ++ show response
      respond $
        responseBuilder status200 corsHeaders $ copyByteString $ BL.toStrict response
