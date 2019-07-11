{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Init.Protocol
  ( EventInit(..)
  , initTopic
  , addEvent
  , receiveEvent
  ) where

import Control.Monad.IO.Class
import qualified Data.Aeson as Ae
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Lazy as BL
import qualified Data.Text as T
import GHC.Generics
import System.Exit

import Blockchain.EthConf.Model
import Blockchain.Data.GenesisInfo
import Blockchain.Stream.Raw
import Blockchain.Strato.StateDiff.Kafka (filterResponse)
import qualified Network.Kafka as K
import qualified Network.Kafka.Protocol as K

data EventInit = EthConf EthConf
               | TopicList [(String, String)]
               | PeerList (Maybe [String])
               | GenesisBlock GenesisInfo
               -- As the generator doesn't need to modify the account info,
               -- its a little simpler to just ship text and the worker will
               -- pipe that to the output file. While it may seem pointless to
               -- backup the potentially huge AccountInfo file, it will preserve
               -- the contents regardless of being input as an image file, an
               -- embedded file, a file on a volume, or a file otherwise generated
               -- at the launch of the container.
               | GenesisAccounts T.Text
               | ApiConfig [(FilePath, B.ByteString)]
               | InitComplete
               deriving (Show, Eq, Generic, Ae.ToJSON, Ae.FromJSON)

initTopic :: K.TopicName
initTopic = "strato-init-events"

addEvent :: K.Kafka k => EventInit -> k ()
addEvent ev = do
  rsp <- produceBytes initTopic [BL.toStrict . Ae.encode $ ev]
  case filterResponse rsp of
    [] -> return ()
    errs -> liftIO . die $ show errs

receiveEvent :: K.Kafka k => K.Offset -> k EventInit
receiveEvent off = do
  _ <- setDefaultKafkaState
  bss <- fetchBytes initTopic off
  case bss of
    [] -> liftIO . die $ "receiveEvent: no event received within 100s"
    (bs:_) -> case Ae.eitherDecodeStrict bs of
                  Left err -> liftIO . die $ "corrupt EventInit: " ++ show (err, C8.unpack bs)
                  Right ev -> return ev
