{-# LANGUAGE OverloadedStrings #-}

module Executable.StratoP2PServerComm (
  runStratoP2PServerComm
  ) where

import Control.Monad.Trans (liftIO)
import Control.Concurrent.STM.MonadIO
import Data.Conduit
import Data.Conduit.Network
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy.Char8 as BLC
import qualified Data.Set as S
import Network.JsonRpc.Server


runStratoP2PServerComm::TVar (S.Set String)->IO ()
runStratoP2PServerComm addresses = do
  runTCPServer (serverSettings 14000 "*") $ \app -> do
      appSource app =$= serve addresses $$ appSink app
      --appSource app =$= serve (fromList [method "getPeers" (getPeers peersList)]) $$ appSink app

serve::TVar (S.Set String)->Conduit B.ByteString IO B.ByteString
serve addresses = do
  Just request <- await
  Just response <- liftIO $ call [getPeers addresses] $ BLC.fromStrict request
  yield $ BLC.toStrict $ response

getPeers::TVar (S.Set String)->Method IO
getPeers theSet = toMethod "getPeers" f ()
  where f::RpcResult IO [String]
        f = do
          val <- readTVar theSet
          return $ S.toList val

                   
