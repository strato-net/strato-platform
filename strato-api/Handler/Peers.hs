{-# LANGUAGE OverloadedStrings #-}

module Handler.Peers where

import Import hiding ((</>), readFile)

import qualified Data.ByteString.Lazy as BL
import           Data.Aeson
import           Data.Conduit.Network
import qualified Data.HashMap.Strict as H
import           Data.Maybe
import qualified Data.Text as T

getPeersR :: Handler Value
getPeersR = do 
  addHeader "Access-Control-Allow-Origin" "*"
  serverResponse <- try $ liftIO $ getPeers 14000
  let serverVal =
        case serverResponse of
         Left err -> Object $ H.fromList [("error", String $ T.pack $ show (err::SomeException))]
         Right (Just (Object o)) -> fromMaybe (String "qqqq") $ lookup "result" o
         
  clientResponse <- try $ liftIO $ getPeers 14001
  let clientVal = case clientResponse of
        Left err -> Object $ H.fromList [("error", String $ T.pack $ show (err::SomeException))]
        Right (Just (Object o)) -> fromMaybe (String "qqqq") $ lookup "result" o
  return $ object ["serverPeers" .= serverVal, "clientPeers" .= clientVal]

getPeers::Int->IO (Maybe Value)
getPeers port = do
  runTCPClient (clientSettings port "127.0.0.1") $ \appData -> do
    appSource appData $$ getPeersRPC `fuseUpstream` appSink appData

getPeersRPC = do
  yield "{\"jsonrpc\": \"2.0\", \"method\": \"getPeers\", \"id\": 1}"
  response <- await
  return $ decode $ BL.fromStrict $ fromJust response
