{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections #-}

module Handler.Peers where

import Import hiding ((</>), readFile)

import Control.Monad.Trans.Except (runExceptT)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Lazy as BL
import           Data.Conduit.Network
import           Data.Either (isLeft)
import qualified Data.Text as T
import           Data.Traversable (for)
import           Network.JsonRpc.Client

import           Blockchain.P2PRPC

getPeersR :: Handler Value
getPeersR = do 
  addHeader "Access-Control-Allow-Origin" "*"
  let host = "localhost"
  let fields = [("serverPeers", (host, serverCommPort)), ("clientPeers", (host, clientCommPort))]

  qs <- for fields $ \(k, (host', port)) -> liftIO . try $ ((k,) <$> (getPeersIO host' port))
  let fails = [q | q <- qs, isLeft q]
  if null fails
    then return . object $ pairify <$> qs
    else sendResponseStatus status504 (T.pack "RPC call to p2p unsuccessful") -- error "500"

  where pairify :: (ToJSON a) => Either SomeException (Text, a) -> (Text, Value)
        pairify (Right (k, v)) = k .= v
        paifify (Left _) = error "this can't happen"

mkConn :: BS.ByteString -> CommPort -> Connection IO
mkConn host (CommPort port) input = liftIO $ (fmap BL.fromStrict) <$> runTCPClient (clientSettings port host) c 
  where runRPCInput = yield (BL.toStrict input) >> await
        c app = appSource app $$ (runRPCInput `fuseUpstream` appSink app)

-- makeRPC :: (ToJSON t) => Signature ps t -> BS.ByteString -> CommPort -> IO (Either RpcError t)
-- makeRPC sig host port = runExceptT $ toFunction (mkConn host port) sig

-- getPeersIO :: BS.ByteString -> CommPort -> IO (Either RpcError [RPCPeer])
-- getPeersIO = makeRPC getPeersSignature

getPeersIO :: BS.ByteString -> CommPort -> IO (Either RpcError [RPCPeer])
getPeersIO host port = runExceptT $ toFunction (mkConn host port) getPeersSignature
