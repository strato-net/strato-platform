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
import Blockchain.Init.Options (flags_dockerMode)
import Blockchain.Init.EthConf
import Blockchain.Init.Options (flags_jsonrpc, flags_localAuth, flags_sslDir)
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
import System.Environment (lookupEnv)
import System.FilePath ((</>))
import System.Entropy (getEntropy)
import qualified Data.ByteString as BS
import Data.Char (toLower)
import Turtle (chmod, roo)
import UnliftIO.Directory
import System.Posix.Files (setFileMode, ownerModes, groupModes, otherModes)
import Data.Bits ((.|.))

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
createCommandsFile = do
  localAuthCommands <- if flags_localAuth
    then do
      pgPassword <- filter (/= '\n') <$> readFile "secrets/postgres_password"
      return ["blockapps-vault-wrapper-server --pghost localhost --password " ++ pgPassword ++ " --port 8093 --vaultPasswordFile secrets/vault_password +RTS -T -RTS"]
    else return []

  let baseCommands =
        [ "ethereum-discover +RTS -T -RTS"
        , "strato-p2p +RTS -T -RTS"
        , "strato-sequencer +RTS -T -N1 -RTS"
        , "vm-runner --diffPublish=true +RTS -T -I2 -N1 -RTS"
        , "strato-p2p-indexer"
        , "strato-api-indexer"
        , "slipstream +RTS -T -RTS"
        , "strato-api +RTS -T -N1 -RTS"
        , "strato-network-monitor"
        ]

      jsonrpcCommands =
        if flags_jsonrpc
          then ["ethereum-jsonrpc +RTS -T -RTS"]
          else []

  writeFile "commands.txt" $ unlines (localAuthCommands ++ baseCommands ++ jsonrpcCommands)



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

    -- Validate SSL directory contents before doing any setup
    when (not $ null flags_sslDir) $ do
      let certPath = flags_sslDir </> "server.pem"
          keyPath  = flags_sslDir </> "server.key"
      certExists <- doesFileExist certPath
      unless certExists $
        liftIO $ error $ "SSL certificate not found: " ++ certPath
      keyExists <- doesFileExist keyPath
      unless keyExists $
        liftIO $ error $ "SSL key not found: " ++ keyPath

    -- Create node directories first (needed before genEthConf reads postgres_password)
    liftIO $ mapM_ (createDirectoryIfMissing True)
      ["postgres", "redis", "kafka", "prometheus", "logs", "secrets", ".ethereumH"]

    -- Make logs directory world-writable for containers running as non-root users (e.g. prometheus)
    liftIO $ setFileMode "logs" (ownerModes .|. groupModes .|. otherModes)

    -- Copy SSL cert and key into the node's secrets/ssl/ directory
    when (not $ null flags_sslDir) $ liftIO $ do
      createDirectoryIfMissing True ("secrets" </> "ssl")
      copyFile (flags_sslDir </> "server.pem") ("secrets" </> "ssl" </> "server.pem")
      copyFile (flags_sslDir </> "server.key") ("secrets" </> "ssl" </> "server.key")
      putStrLn "  ✓ SSL certificate and key installed"

    -- Set postgres password: use env var if provided, otherwise generate random
    let pgPasswordFile = "secrets" </> "postgres_password"
    pgPasswordExists <- doesFileExist pgPasswordFile
    unless pgPasswordExists $ liftIO $ do
      envPassword <- lookupEnv "postgres_password"
      password <- case envPassword of
        Just pw | not (null pw) -> return pw
        _ -> generatePassword 32
      putStrLn $ "  Creating postgres password file: " ++ pgPasswordFile
      writeFile pgPasswordFile password
      void $ chmod roo pgPasswordFile

    -- Set vault password for local auth mode: use env var if provided, otherwise generate random
    when flags_localAuth $ do
      let vaultPasswordFile = "secrets" </> "vault_password"
      vaultPasswordExists <- doesFileExist vaultPasswordFile
      unless vaultPasswordExists $ liftIO $ do
        envPassword <- lookupEnv "vault_password"
        password <- case envPassword of
          Just pw | not (null pw) -> return pw
          _ -> generatePassword 32
        putStrLn $ "  Creating vault password file: " ++ vaultPasswordFile
        writeFile vaultPasswordFile password
        void $ chmod roo vaultPasswordFile

      let hydraSystemSecretFile = "secrets" </> "local_auth_hydra_system_secret"
      hydraSystemSecretExists <- doesFileExist hydraSystemSecretFile
      unless hydraSystemSecretExists $ liftIO $ do
        envSecret <- lookupEnv "LOCAL_AUTH_HYDRA_SYSTEM_SECRET"
        secret <- case envSecret of
          Just s | not (null s) -> return s
          _ -> generatePassword 64
        putStrLn $ "  Creating local-auth Hydra system secret file: " ++ hydraSystemSecretFile
        writeFile hydraSystemSecretFile secret
        void $ chmod roo hydraSystemSecretFile

      let hydraPairwiseSaltFile = "secrets" </> "local_auth_hydra_pairwise_salt"
      hydraPairwiseSaltExists <- doesFileExist hydraPairwiseSaltFile
      unless hydraPairwiseSaltExists $ liftIO $ do
        envSalt <- lookupEnv "LOCAL_AUTH_HYDRA_PAIRWISE_SALT"
        salt <- case envSalt of
          Just s | not (null s) -> return s
          _ -> generatePassword 64
        putStrLn $ "  Creating local-auth Hydra pairwise salt file: " ++ hydraPairwiseSaltFile
        writeFile hydraPairwiseSaltFile salt
        void $ chmod roo hydraPairwiseSaltFile

      let kratosCookieSecretFile = "secrets" </> "local_auth_kratos_cookie_secret"
      kratosCookieSecretExists <- doesFileExist kratosCookieSecretFile
      unless kratosCookieSecretExists $ liftIO $ do
        envSecret <- lookupEnv "LOCAL_AUTH_KRATOS_COOKIE_SECRET"
        secret <- case envSecret of
          Just s | not (null s) -> return s
          _ -> generatePassword 64
        putStrLn $ "  Creating local-auth Kratos cookie secret file: " ++ kratosCookieSecretFile
        writeFile kratosCookieSecretFile secret
        void $ chmod roo kratosCookieSecretFile

    -- OAuth credentials: generate secure local creds for --localAuth,
    -- otherwise copy from ~/.secrets/ (external OAuth mode)
    let destOauth = "secrets" </> "oauth_credentials.yaml"
    destOauthExists <- doesFileExist destOauth
    unless destOauthExists $ liftIO $ do
      if flags_localAuth
        then do
          envClientId <- lookupEnv "OAUTH_CLIENT_ID"
          envClientSecret <- lookupEnv "OAUTH_CLIENT_SECRET"
          clientId <- case envClientId of
            Just cid | not (null cid) -> return cid
            _ -> generateClientId 16
          clientSecret <- case envClientSecret of
            Just cs | not (null cs) -> return cs
            _ -> generatePassword 48
          let localOauthConfig = unlines
                [ "discoveryUrl: \"http://localhost:8081/auth/.well-known/openid-configuration\""
                , "clientId: \"" ++ clientId ++ "\""
                , "clientSecret: \"" ++ clientSecret ++ "\""
                ]
          writeFile destOauth localOauthConfig
          void $ chmod roo destOauth
          putStrLn $ "  ✓ Generated secure local OAuth credentials: " ++ destOauth
        else do
          home <- getHomeDirectory
          let sourceOauth = home </> ".secrets" </> "strato_credentials.yaml"
          sourceExists <- doesFileExist sourceOauth
          if sourceExists
            then do
              copyFile sourceOauth destOauth
              void $ chmod roo destOauth
            else
              error "OAuth credentials not found at ~/.secrets/strato_credentials.yaml. Run 'strato-login' first."
    -- Setup OAuth credentials
    liftIO $ do
      let destOauth' = "secrets" </> "oauth_credentials.yaml"
      if flags_localAuth
        then putStrLn "  ✓ Local auth mode: OAuth configured for local Hydra"
        else do
          -- Copy OAuth credentials from ~/.secrets/
          home <- getHomeDirectory
          let sourceOauth = home </> ".secrets" </> "strato_credentials.yaml"
          sourceExists <- doesFileExist sourceOauth
          if sourceExists
            then do
              copyFile sourceOauth destOauth'
              void $ chmod roo destOauth'
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
      "allDocker" -> generateDockerComposeAllDocker
      _ -> generateDockerCompose

    liftIO createCommandsFile
    liftIO $ putStrLn "  ✓ Generated commands.txt"

    -- Custom genesis support: when genesis.json is pre-placed (e.g. useCustomGenesis=true in
    -- docker-compose for single-node CI/CD builds), read it and populate the LevelDB trie from it.
    -- DO NOT REMOVE this branch — without it, custom genesis nodes crash with "Missing StateRoot".
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

generateClientId :: Int -> IO String
generateClientId len = do
  suffix <- fmap (map toLower) (generatePassword len)
  return $ "strato-local-" ++ suffix
