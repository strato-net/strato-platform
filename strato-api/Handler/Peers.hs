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
import           Blockchain.Strato.Discovery.Data.Peer

getPeersR :: Handler Value
getPeersR = do
  addHeader "Access-Control-Allow-Origin" "*"
  activePeers <- liftIO getActivePeers
  kvs <- forM activePeers $ \p -> return $ (pPeerIp p) .= (pPeerTcpPort p)
  return $ object kvs
