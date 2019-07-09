{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Init.Generator where

import Control.Monad
import qualified Data.Aeson as Ae
import qualified Data.ByteString.Char8 as C8
import Data.FileEmbed
import Data.Maybe
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8)
import qualified Data.Text.IO as TIO
import System.Directory
import System.Exit
import System.IO

import Blockchain.APIFiles
import Blockchain.Data.ChainInfo
import Blockchain.Data.GenesisInfo
import Blockchain.Init.Protocol
import Blockchain.Init.EthConf
import Blockchain.Init.Options
import Blockchain.Strato.Model.Address

genesisFiles :: [(FilePath, C8.ByteString)]
genesisFiles = $(embedDir "genesisBlocks")

mkAll :: String -> IO ()
mkAll genesisBlockName = do
  ethconf <- genEthConf
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

sendGenesisJson :: FilePath -> [Address] -> IO ()
sendGenesisJson genesisFilename extraFaucets = do
  fsFile <- doesFileExist genesisFilename
  eGenInfo <- if fsFile
                then Ae.eitherDecodeFileStrict' genesisFilename
                else return $ do
                  contents <- maybe (Left "file not found") Right $ lookup genesisFilename genesisFiles
                  Ae.eitherDecodeStrict' contents
  case eGenInfo of
    Left err -> die err
    Right genInfo -> do
      let faucetBalance = 0x1000000000000000000000000000000000000000000000000000000000000
          faucetAccounts = map (flip NonContract faucetBalance) extraFaucets
      addEvent $ GenesisBlock genInfo {
                    genesisInfoAccountInfo = faucetAccounts ++ (genesisInfoAccountInfo genInfo)
               }


sendAccountInfo :: FilePath -> IO ()
sendAccountInfo accountInfoFileName = do
  fsFile <- doesFileExist accountInfoFileName
  if fsFile
    then do
      let sendChunks :: Handle -> IO ()
          sendChunks h = do
            chk <- TIO.hGetChunk h
            unless (T.null chk) $ do
              addEvent $ GenesisAccounts chk
              sendChunks h
      withFile accountInfoFileName ReadMode $ \h -> do
        hSetBuffering h (BlockBuffering (Just (1024 * 1024)))
        sendChunks h
    else case lookup accountInfoFileName genesisFiles of
            Nothing -> putStrLn "No account info found, assuming it isn't needed"
            Just bs -> addEvent $ GenesisAccounts $ decodeUtf8 bs
