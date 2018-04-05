{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections       #-}

module Handler.Peers where

import           Import                     hiding (readFile, (</>))

import           Blockchain.Strato.Discovery.Data.Peer

getPeersR :: Handler Value
getPeersR = do
  addHeader "Access-Control-Allow-Origin" "*"
  activePeers <- liftIO getActivePeers
  kvs <- forM activePeers $ \p -> return $ (pPeerIp p) .= (pPeerTcpPort p)
  return $ object kvs
