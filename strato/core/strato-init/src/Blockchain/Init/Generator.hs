{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE NumericUnderscores #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Blockchain.Init.Generator (
  createGenesisInfo,
  mkFilesAndGenesis
  ) where

import Blockchain.Data.GenesisInfo (GenesisInfo)
import qualified Blockchain.Data.GenesisInfo as GI
import Blockchain.DB.CodeDB
import Blockchain.Data.GenesisBlock (populateMPTAndWriteGenesis, populateMPTFromGenesis)
import Blockchain.Init.DockerCompose
import Blockchain.Init.DockerComposeAllDocker (generateDockerComposeAllDocker)
import Blockchain.Init.Options (flags_dockerMode, flags_includeBuild)
import Blockchain.Init.EthConf
import Blockchain.GenesisBlocks.HeliumGenesisBlock as HELIUM
import Blockchain.Init.Monad
import Blockchain.Strato.Model.Validator
import Conduit
import Control.Monad
import Control.Monad.Change.Alter ()
import BlockApps.Logging (runNoLoggingT)
import qualified Data.Aeson as JSON
import qualified Data.ByteString.Lazy as BL
import Data.Maybe
import qualified Data.Yaml as YAML
import System.FilePath ((</>))
import System.Entropy (getEntropy)
import qualified Data.ByteString as BS
import Text.RawString.QQ
import Turtle (chmod, roo)
import UnliftIO.Directory

-- | Create a GenesisInfo from network name. Does NOT write to file.
-- The stateRoot in the returned GenesisInfo is a placeholder - the real
-- stateRoot is computed when the merkle patricia trie is populated,
-- and genesis.json is written at that point with the correct value.
createGenesisInfo :: String -> GI.GenesisInfo
createGenesisInfo network =
  case network of
    "upquark" -> HELIUM.genesisBlockTemplate config
      where config = HELIUM.HeliumGenesisBlockConfig
              upquarkValidators
              upquarkAdmins
              HELIUM.blockappsProdAddress
              []
              []
              upquarkBridgeRelayer
              upquarkOracleRelayers
            upquarkValidators = -- TODO: move this to a more logical place
              [ Validator 0x2e8462e383a1d516cfbf13d7cf4826ce77b4b91e
              , Validator 0x3e7b7d721cf9a4ec9f7c87a6c02572bb7ef1bbf4
              , Validator 0x4d8cb07af178cb10db093abea710b73179a5dd16
              , Validator 0x4dd4bb6125cefd36d5adfbb303d8f00787b7ea0c
              ]
            upquarkAdmins =
              [ 0x7630b673862a2807583834908f10192e00c58b00 --Kieren
              , 0x292dd9591f506845ef05a9f3b8116e641cbcb4bb --Victor
              , 0xf1ba16a6cfb2a17fb34ad477eaaf0c76eac64f14 --Jamshid
              ]
            upquarkBridgeRelayer =
              (0x882f3d3a7b97ea24ab5aeae6996a695b26ea9089, 100_000 * HELIUM.oneE18)
            upquarkOracleRelayers =
              [ (0x96714c4a2163a3ee55356e20bc23fe8ea5e7aaf0, 100_000 * HELIUM.oneE18)
              , (0x523fef378674d39363aa8b6ac5122e301c528432, 100_000 * HELIUM.oneE18)
              ]
    "lithium" -> HELIUM.lithiumGenesisBlock
    _ -> HELIUM.genesisBlock

createCommandsFile :: IO ()
createCommandsFile =
  writeFile "commands.txt" [r|ethereum-discover +RTS -T -RTS

strato-p2p +RTS -T -RTS

strato-sequencer +RTS -T -N1 -RTS

vm-runner --diffPublish=true +RTS -T -I2 -N1 -RTS

strato-p2p-indexer

strato-api-indexer

slipstream +RTS -T -RTS

strato-api +RTS -T -N1 -RTS

strato-network-monitor
|]



-- | Create files AND populate Merkle Patricia Trie, write genesis.json with computed stateRoot.
-- This is called by strato-setup before docker containers are running.
mkFilesAndGenesis :: (MonadUnliftIO m, MonadFail m) =>
                     FilePath -> Bool -> String -> m ()
mkFilesAndGenesis nodeDir hasFlags network = do
  -- Create node directory and cd to it
  liftIO $ do
    createDirectoryIfMissing True nodeDir
    setCurrentDirectory nodeDir

  -- Check if node already exists
  nodeExists <- doesFileExist (".ethereumH" </> "ethconf.yaml")
  when nodeExists $ do
    if hasFlags
      then liftIO $ error $ "Node already exists at " ++ nodeDir ++ ". Run without options to use it, or remove the directory to recreate."
      else do
        liftIO $ putStrLn $ "Node already exists at " ++ nodeDir ++ ", skipping setup."
        return ()
  
  unless nodeExists $ do
    liftIO $ putStrLn $ "Setting up STRATO node: " ++ nodeDir
    liftIO $ putStrLn $ "  Network: " ++ network

    -- Create node directories first (needed before genEthConf reads postgres_password)
    liftIO $ mapM_ (createDirectoryIfMissing True)
      ["postgres", "redis", "kafka", "prometheus", "logs", "secrets", ".ethereumH"]

    -- Generate random postgres password (needed by genEthConf)
    let pgPasswordFile = "secrets" </> "postgres_password"
    pgPasswordExists <- doesFileExist pgPasswordFile
    unless pgPasswordExists $ liftIO $ do
      password <- generatePassword 32
      writeFile pgPasswordFile password
      void $ chmod roo pgPasswordFile

    -- Copy OAuth credentials from ~/.secrets/
    liftIO $ do
      home <- getHomeDirectory
      let sourceOauth = home </> ".secrets" </> "strato_credentials.yaml"
          destOauth = "secrets" </> "oauth_credentials.yaml"
      sourceExists <- doesFileExist sourceOauth
      if sourceExists
        then do
          copyFile sourceOauth destOauth
          void $ chmod roo destOauth
        else
          error "OAuth credentials not found at ~/.secrets/strato_credentials.yaml. Run 'strato-login' first."

    ethconf <- liftIO genEthConf

    let dir = ".ethereumH"
    liftIO $ YAML.encodeFile (dir </> "ethconf.yaml") ethconf
    liftIO $ makeReadOnly $ dir </> "ethconf.yaml"
    liftIO $ putStrLn "  ✓ Generated ethconf.yaml"

    liftIO $ do
      cwd <- getCurrentDirectory
      home <- getHomeDirectory
      let stratoDir = home </> ".strato"
          defaultNodeFile = stratoDir </> "default-node"
      createDirectoryIfMissing True stratoDir
      writeFile defaultNodeFile cwd

    -- Generate docker-compose.yml
    liftIO $ case flags_dockerMode of
      "allDocker" -> generateDockerComposeAllDocker False flags_includeBuild
      _ -> generateDockerCompose

    liftIO createCommandsFile
    liftIO $ putStrLn "  ✓ Generated commands.txt"

    genesisExists <- doesFileExist "genesis.json"

    if genesisExists
      then do
        liftIO $ putStrLn "  ✓ Using provided genesis.json"
        content <- liftIO $ BS.readFile "genesis.json"
        case JSON.decode (BL.fromStrict content) of
          Nothing -> error "Failed to parse provided genesis.json"
          Just genesisInfo -> runNoLoggingT . runResourceT . runSetupDBM $ do
            void $ addCode mempty
            populateMPTFromGenesis genesisInfo
      else do
        let genesisInfo = normalizeGenesisInfo $ createGenesisInfo network
        runNoLoggingT . runResourceT . runSetupDBM $ do
          void $ addCode mempty
          populateMPTAndWriteGenesis genesisInfo
        liftIO $ putStrLn "  ✓ Created genesis.json"

    liftIO $ putStrLn "Node ready"

-- We have to normalize the information held in GenesisInfo, unfortunalely we have some characters that done encode and decode back from JSON the same
-- If we don't do this, the stateroot created from the raw data won't match that if created from the data read from genesis.json
normalizeGenesisInfo :: GenesisInfo -> GenesisInfo
normalizeGenesisInfo = fromMaybe (error "Internal Error in normalizeGenesisInfo: this shouldn't happen") . JSON.decode . JSON.encode

makeReadOnly :: FilePath -> IO ()
makeReadOnly = void . chmod roo

generatePassword :: Int -> IO String
generatePassword len = do
  bytes <- getEntropy len
  return $ map toChar (BS.unpack bytes)
  where
    chars = ['a'..'z'] ++ ['A'..'Z'] ++ ['0'..'9']
    toChar b = chars !! (fromIntegral b `mod` length chars)
