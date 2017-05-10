{-# LANGUAGE OverloadedStrings #-}

module Handler.Peers where

import Import hiding ((</>), readFile)

import qualified Data.ByteString.Lazy as BL
import           Data.Aeson
import           Data.Conduit.Network
import qualified Data.HashMap.Strict as H
import           Data.Maybe
import qualified Data.Text as T
import           Data.Traversable (for)
import           Network.JsonRpc.Client

import           Blockchain.P2PRPC


getPeersR :: Handler Value
getPeersR = do 
  addHeader "Access-Control-Allow-Origin" "*"
  let fields = [("serverPeers", serverCommPort), ("clientPeers", clientCommPort)]
  fmap object $ for fields $ \(k, p) -> do
    resp <- try (getPeers p)
    let ret = case resp of
         Left err -> Object $ H.fromList [("error", String $ T.pack $ show (err::SomeException))]
         Right (Just (Object o)) -> fromMaybe (String "qqqq") $ lookup "result" o
         Right _ -> ""
    return $ k .= ret

getPeers :: MonadIO m => CommPort -> m (Maybe Value)
getPeers (CommPort port) = liftIO $ do
  runTCPClient (clientSettings port "127.0.0.1") $ \appData -> do
    appSource appData $$ getPeersRPC `fuseUpstream` appSink appData
  where
    getPeersRPC :: ConduitM ByteString ByteString IO (Maybe Value) 
    getPeersRPC = do
      yield "{\"jsonrpc\": \"2.0\", \"method\": \"getPeers\", \"id\": 1}"
      response <- await
      return $ decode $ BL.fromStrict $ fromJust response
