{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Init.Generator where

import Blockchain.Init.EthConf
import Blockchain.Init.Options
import Blockchain.Init.Protocol
import qualified Blockchain.Network as Net
import Blockchain.Strato.Model.Options (flags_network)
import Control.Monad
import Control.Monad.Catch
import Control.Monad.Composable.Kafka
import Control.Monad.IO.Unlift
import Control.Monad.Trans.Except
import Control.Monad.Trans.State
import qualified Data.Aeson as Ae
import qualified Data.ByteString.Char8 as C8
import Data.FileEmbed
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8)
import qualified Data.Text.IO as TIO
import Network.Kafka (Kafka, KafkaClientError, KafkaState)
import System.Exit
import UnliftIO.Directory
import UnliftIO.IO hiding (withFile)

import Universum.Lifted.File

type GenM = StateT KafkaState (ExceptT KafkaClientError IO)

runGenM :: MonadIO m =>
           KafkaAddress -> KafkaM m a -> m a
runGenM kaddr mv = do
  runKafkaM "generator" kaddr mv

initializeTopic :: Kafka m => m ()
initializeTopic = createTopic initTopic

genesisFiles :: [(FilePath, C8.ByteString)]
genesisFiles = $(embedDir "genesisBlocks")

mkAll :: (MonadMask m, HasKafka m) =>
         String -> m ()
mkAll genesisBlockName = do
  execKafka initializeTopic
  ethconf <- liftIO genEthConf
  addEvent $ EthConf ethconf

  addEvent $
    TopicList
      [ (t, t)
        | t <-
            [ "statediff",
              "seq_vm_events",
              "seq_p2p_events",
              "unseqevents",
              "jsonrpcresponse",
              "indexevents",
              "block",
              "vmevents",
              "solidvmevents"
            ]
      ]

  bootnodes <- case (flags_addBootnodes, flags_stratoBootnode) of
    (False, _) -> return Nothing
    (True, []) -> liftIO $ fmap (fmap $ map Net.webAddress) $ Net.getParams flags_network
    (True, _) -> return $ Just flags_stratoBootnode

  addEvent $ PeerList bootnodes

  let genesisFileName = genesisBlockName ++ "Genesis.json"
      accountInfoFileName = genesisBlockName ++ "AccountInfo"

  sendGenesisJson genesisFileName
  sendAccountInfo accountInfoFileName

  addEvent InitComplete

sendGenesisJson :: HasKafka m =>
                   FilePath -> m ()
sendGenesisJson genesisFilename = do
  fsFile <- doesFileExist genesisFilename
  eGenInfo <-
    if fsFile
      then liftIO $ Ae.eitherDecodeFileStrict' genesisFilename
      else return $ do
        contents <- maybe (Left "file not found") Right $ lookup genesisFilename genesisFiles
        Ae.eitherDecodeStrict' contents
  case eGenInfo of
    Left err -> liftIO $ die err
    Right genInfo -> addEvent $ GenesisBlock genInfo

sendAccountInfo :: (MonadMask m, HasKafka m) =>
                   FilePath -> m ()
sendAccountInfo accountInfoFileName = do
  fsFile <- doesFileExist accountInfoFileName
  if fsFile
    then do
      let sendChunks :: HasKafka m => Handle -> m ()
          sendChunks h = do
            chk <- liftIO $ TIO.hGetChunk h
            unless (T.null chk) $ do
              addEvent $ GenesisAccounts chk
              sendChunks h
      withFile accountInfoFileName ReadMode $ \h -> do
        hSetBuffering h (BlockBuffering (Just (1024 * 1024)))
        sendChunks h
    else case lookup accountInfoFileName genesisFiles of
      Nothing -> liftIO $ putStrLn "No account info found, assuming it isn't needed"
      Just bs -> addEvent $ GenesisAccounts $ decodeUtf8 bs
