{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections       #-}

module Handler.Peers where

import           Import                     hiding (readFile, (</>))

import           Control.Monad.Trans.Except (runExceptT)
import qualified Data.ByteString            as BS
import qualified Data.ByteString.Lazy       as BL
import           Data.Conduit.Network
import           Data.Either                (isLeft)
import qualified Data.Text                  as T
import           Data.Traversable           (for)
import           Network.JsonRpc.Client

import           Blockchain.P2PRPC

getPeersR :: Handler Value
getPeersR = do
  addHeader "Access-Control-Allow-Origin" "*"
  let host = "localhost"
  let fields = [("serverPeers", (host, serverCommPort)), ("clientPeers", (host, clientCommPort))]

  qs <- for fields $ \(k, (host', port)) -> liftIO . try $ ((k,) <$> (getPeersIO host' port))
  let fails = [q | Left q <- qs]
  if null fails
    then return . object $ pairify <$> qs
    else sendResponseStatus status504 (T.pack $ "RPC calls to p2p unsuccessful: " ++ show fails) -- error "500"

  where pairify :: (ToJSON b) => Either SomeException (Text, Either a b) -> (Text, Value)
        pairify (Right (k, Right v)) = k .= v
        pairify _                    = error "this can't happen"
