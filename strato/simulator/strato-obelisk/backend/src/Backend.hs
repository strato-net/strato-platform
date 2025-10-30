{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
module Backend where

import Backend.Server (application)
import Common.Message
import Common.Route
import Control.Concurrent
import Control.Concurrent.Async (race_)
import Control.Concurrent.STM.TChan
import Control.Exception (SomeException(..), try)
import Control.Monad (forever, void)
import Control.Monad.IO.Class (liftIO)
import Data.Dependent.Sum (DSum (..))
import Data.Functor.Identity
import Data.List (find)
import qualified Data.Map.Strict as M
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Encoding
import GHC.Conc
import Network.HTTP.Client as HTC hiding (Proxy)
import Network.HTTP.Req as R
import Network.WebSockets.Snap
import Obelisk.Backend
import Text.URI as URI

pingThread :: Text -> Nodes -> IO ()
pingThread stratoLiteRoute nodes' = do
  let nodesRoute = stratoLiteRoute <> "/nodes"
  nodesUri <- URI.mkURI nodesRoute
  let getNodesMap = case R.useURI nodesUri of
        Nothing -> error . T.unpack $ "Could not decode URI: " <> nodesRoute
        Just e -> case e of
          Left (url, opts) -> HTC.responseBody . toVanillaResponse <$> runReq defaultHttpConfig (R.req R.GET url R.NoReqBody jsonResponse (opts <> (R.header "Content-Type" $ encodeUtf8 $ T.pack "application/json")))
          Right (url, opts) -> HTC.responseBody . toVanillaResponse <$> runReq defaultHttpConfig (R.req R.GET url R.NoReqBody jsonResponse (opts <> (R.header "Content-Type" $ encodeUtf8 $ T.pack "application/json")))
  forever $ do
    e :: Either SomeException () <- try $ do
      nodesMap <- getNodesMap
      void . flip M.traverseWithKey nodesMap $ \n ns@(NodeStatus i _ _ _) -> do
        _ :: Either SomeException () <- try $ do
          let peersRoute = nodesRoute <> "/" <> n <> "/strato-api/eth/v1.2/peers"
          peersUri <- URI.mkURI peersRoute
          let getNodePeers = case useURI peersUri of
                Nothing -> error . T.unpack $ "Could not decode URI: " <> peersRoute
                Just e -> case e of
                  Left (url, opts) -> HTC.responseBody . toVanillaResponse <$> runReq defaultHttpConfig (R.req R.GET url R.NoReqBody jsonResponse (opts <> (R.header "Content-Type" $ encodeUtf8 $ T.pack "application/json")))
                  Right (url, opts) -> HTC.responseBody . toVanillaResponse <$> runReq defaultHttpConfig (R.req R.GET url R.NoReqBody jsonResponse (opts <> (R.header "Content-Type" $ encodeUtf8 $ T.pack "application/json")))
          nodePeers :: M.Map Text Int <- getNodePeers
          let peersList = M.keys nodePeers
              node = Node n (Just ns) peersList
          nodesVal <- readTVarIO $ _nodes nodes'
          let updatePeer p = M.alter
                (\case
                    Nothing -> Just $ Node p Nothing [i]
                    Just (Node n' s ps) -> case find (==i) ps of
                      Nothing -> Just $ Node n' s (i:ps)
                      Just _  -> Just $ Node n' s ps
                ) p
          let nodesVal' = foldr updatePeer (M.insert i node nodesVal) peersList
          -- putStrLn $ show nodesVal'
          atomically $ do
            writeTVar (_nodes nodes') nodesVal'
        pure ()
      pure ()
    case e of
      Left ex -> putStrLn $ show ex
      _ -> pure ()
    atomically $ writeTChan (_ping nodes') ()
    threadDelay 2000000
    pure ()

backend :: Backend BackendRoute FrontendRoute
backend = Backend
  { _backend_run = \serve -> do
      stratoLiteRoute <- T.pack <$> readFile "config/common/strato-lite-route"
      nodes' <- liftIO newNodesIO
      atomically $ writeTVar (_nodes nodes') M.empty
      race_ (pingThread stratoLiteRoute nodes') $
        serve $ \case
          BackendRoute_Missing :=> Identity () -> pure ()
          BackendRoute_Network :=> Identity () -> do
            runWebSocketsSnap $ application nodes'
  , _backend_routeEncoder = fullRouteEncoder
  }
