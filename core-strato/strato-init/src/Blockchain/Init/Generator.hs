{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Init.Generator where

import Control.Concurrent
import Control.Lens.Combinators (use)
import Control.Monad
import Control.Monad.IO.Unlift
import Control.Monad.Trans.Except
import Control.Monad.Trans.State
import qualified Data.Aeson as Ae
import qualified Data.ByteString.Char8 as C8
import Data.FileEmbed
import Data.Maybe
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8)
import qualified Data.Map as M
import qualified Data.Text.IO as TIO
import System.Exit
import UnliftIO.Directory
import UnliftIO.IO

import Blockchain.APIFiles
import Blockchain.Data.ChainInfo
import Blockchain.Data.GenesisInfo
import Blockchain.Init.Protocol
import Blockchain.Init.EthConf
import Blockchain.Init.Options
import Blockchain.Strato.Model.Address
import Network.Kafka (KafkaAddress, mkKafkaState, runKafka, updateMetadata, KafkaState, KafkaClientError, stateTopicMetadata)
import Network.Kafka.Protocol (KafkaError(..), TopicMetadata(..))

type GenM = StateT KafkaState (ExceptT KafkaClientError IO)

runGenM :: KafkaAddress -> GenM a -> IO a
runGenM kaddr mv = do
  eRes <- runKafka (mkKafkaState "generator" kaddr) mv
  either (die . ("runGenM: " ++) . show) return eRes

initializeTopic :: GenM ()
initializeTopic = do
  updateMetadata initTopic
  meta <- use stateTopicMetadata
  -- Wait until the broker believes in the metadata
  case M.lookup initTopic meta of
    Just (TopicMetadata (NoError, _, _)) -> return ()
    _ -> liftIO (threadDelay 100000) >> initializeTopic

genesisFiles :: [(FilePath, C8.ByteString)]
genesisFiles = $(embedDir "genesisBlocks")

mkAll :: String -> GenM ()
mkAll genesisBlockName = do
  initializeTopic
  ethconf <- liftIO genEthConf
  addEvent $ EthConf ethconf

  addEvent $ TopicList [(t, t) | t <- ["unminedblock", "statediff", "seq_vm_events", "seq_p2p_events"
                                      , "unseqevents", "jsonrpcresponse", "indexevents", "block"]]
  let bootnodes = if flags_addBootnodes
                    then Just $ filter (not . null) flags_stratoBootnode
                    else Nothing
  addEvent $ PeerList bootnodes

  addEvent $ ApiConfig $ stratoAPICerts ++ stratoAPIConfigDir


  let decodedFaucets = fromMaybe [] . Ae.decodeStrict . C8.pack $ flags_extraFaucets
      genesisFileName = genesisBlockName ++ "Genesis.json"
      accountInfoFileName = genesisBlockName ++ "AccountInfo"

  sendGenesisJson genesisFileName decodedFaucets
  sendAccountInfo accountInfoFileName

  addEvent InitComplete

sendGenesisJson :: FilePath -> [Address] -> GenM ()
sendGenesisJson genesisFilename extraFaucets = do
  fsFile <- doesFileExist genesisFilename
  eGenInfo <- if fsFile
                then liftIO $ Ae.eitherDecodeFileStrict' genesisFilename
                else return $ do
                  contents <- maybe (Left "file not found") Right $ lookup genesisFilename genesisFiles
                  Ae.eitherDecodeStrict' contents
  case eGenInfo of
    Left err -> liftIO $ die err
    Right genInfo -> do
      let faucetBalance = 0x1000000000000000000000000000000000000000000000000000000000000
          faucetAccounts = map (flip NonContract faucetBalance) extraFaucets
      addEvent $ GenesisBlock genInfo {
               genesisInfoAccountInfo = faucetAccounts ++ (genesisInfoAccountInfo genInfo)
             }

sendAccountInfo :: FilePath -> GenM ()
sendAccountInfo accountInfoFileName = do
  fsFile <- doesFileExist accountInfoFileName
  if fsFile
    then do
      let sendChunks :: Handle -> GenM ()
          sendChunks h = do
            chk <- liftIO $ TIO.hGetChunk h
            unless (T.null chk) $ do
              addEvent $ GenesisAccounts chk
              sendChunks h
      s <- get
      liftIO . withFile accountInfoFileName ReadMode $ \h -> do
        hSetBuffering h (BlockBuffering (Just (1024 * 1024)))
        mErr <- runKafka s $ sendChunks h
        either (die . ("sendAccountInfo: " ++) . show) return mErr
    else case lookup accountInfoFileName genesisFiles of
            Nothing -> liftIO $ putStrLn "No account info found, assuming it isn't needed"
            Just bs -> addEvent $ GenesisAccounts $ decodeUtf8 bs
