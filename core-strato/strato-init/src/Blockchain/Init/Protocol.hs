{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Init.Protocol
  ( EventInit(..)
  , initTopic
  , addEvent
  , receiveEvent
  ) where

import qualified Data.Aeson as Ae
import qualified Data.ByteString as B
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

bootstrapState :: K.KafkaAddress -> K.KafkaState
bootstrapState = K.mkKafkaState "strato-init"

addEvent :: K.KafkaAddress -> EventInit -> IO ()
addEvent kaddr ev = do
  eErr <- K.runKafka (bootstrapState kaddr) $ produceBytes initTopic [BL.toStrict . Ae.encode $ ev]
  case eErr of
    Left err -> die $ show err
    Right rsp -> case filterResponse rsp of
                      [] -> return ()
                      errs -> die $ show errs

receiveEvent :: K.KafkaAddress -> K.Offset -> IO EventInit
receiveEvent kaddr off = do
  resps <- K.runKafka (bootstrapState kaddr) $ do
    _ <- setDefaultKafkaState
    fetchBytes initTopic off
  case resps of
    Left err -> die (show err)
    Right [] -> die "no event received within 100s"
    Right (x:_) -> case Ae.eitherDecodeStrict x of
                Left err -> die $ "corrupt EventInit: " ++ show err
                Right ev -> return ev
