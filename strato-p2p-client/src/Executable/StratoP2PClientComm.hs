{-# LANGUAGE OverloadedStrings #-}

module Executable.StratoP2PClientComm (
  runStratoP2PClientComm
  ) where

import Control.Monad.Trans (liftIO)
import Control.Concurrent.STM.MonadIO
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy.Char8 as BLC
import Data.Conduit
import Data.Conduit.Network
import qualified Data.Set as S

import Network.JsonRpc.Server

runStratoP2PClientComm::TVar (S.Set String) -> IO ()
runStratoP2PClientComm addresses = do
  runTCPServer (serverSettings 14001 "*") $ \app -> do
    appSource app =$= serve addresses $$ appSink app

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

