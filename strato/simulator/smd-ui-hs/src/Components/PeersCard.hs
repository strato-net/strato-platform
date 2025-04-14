{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Components.PeersCard where

import Reflex.Dom
import qualified Data.Text as T
import qualified Data.Map as M
import Types.State (PeerInfo(..))
import Components.HexText
import Control.Monad (forM_)

peersCard :: MonadWidget t m => M.Map T.Text PeerInfo -> m ()
peersCard peers = do
  elClass "div" "pt-card pt-elevation-2" $
    if M.null peers
      then el "small" $ text "No peers"
      else forM_ (M.toList peers) $ \(peerId, PeerInfo pk h port) -> do
        elClass "div" "row node-peers" $ do
          row "Peer ID:" $ text peerId
          row "Public Key:" $ hexText pk Nothing
          row "Host:" $ text h
          row "Port:" $ text (T.pack $ show port)
  where
    row label val = do
      elClass "div" "col-xs-3" $ el "small" $ text label
      elClass "div" "col-xs-9" $ el "small" $ val