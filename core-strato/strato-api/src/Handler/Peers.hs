{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Handler.Peers where

import           Import                     hiding (readFile, (</>), fromString)

import           Blockchain.Strato.Discovery.Data.Peer

getPeersR :: Handler Value
getPeersR = do
  addHeader "Access-Control-Allow-Origin" "*"
  eActivePeers <- liftIO getActivePeers
  case eActivePeers of
    Left err -> sendResponseStatus status500 . toJSON . show $ err
    Right ps -> return . object . map (\p -> pPeerIp p .= pPeerTcpPort p) $ ps
