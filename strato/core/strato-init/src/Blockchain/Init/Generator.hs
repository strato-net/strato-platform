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
import qualified Blockchain.EthConf.Model as EC
import Blockchain.Init.LocalAuth (setupLocalAuthSecrets)
import Blockchain.Init.Options (flags_busHost, flags_jsonrpc, flags_localAuth, flags_httpPort, flags_password, flags_pghost, flags_regenerate, flags_sslDir, flags_validatorBehavior, flags_vmQuery, flags_writer)
import Blockchain.Init.Role
import Blockchain.Init.RtsFlags
import Control.Monad.Composable.Streaming.DockerConfig (brokerVolumeDirs)
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
import System.Process (readProcess)
import System.Entropy (getEntropy)
import qualified Data.ByteString as BS
import Data.Char (toLower)
import Turtle (chmod, roo)
import UnliftIO.Directory
import System.Posix.Files (setFileMode, ownerModes, groupModes, otherModes, ownerReadMode, ownerWriteMode, groupReadMode, otherReadMode)
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
    "beryllium" -> HELIUM.berylliumGenesisBlock
    _ -> HELIUM.genesisBlock

-- | Processes convoke may restart on their own when they exit. Everything
-- else takes the whole directory down, as before: p2p, the sequencer and
-- vm-runner share consensus state that a lone restart cannot recover.
restartable :: String -> String
restartable = ("@restart " ++)

createCommandsFile :: Role -> IO ()
createCommandsFile role = do
  localAuthCommands <- if flags_localAuth
    then do
      pgPassword <- filter (/= '\n') <$> readFile "secrets/postgres_password"
      -- The vault wrapper runs on the host, so it needs the same IPv4-loopback
      -- pinning that genEthConf applies to the other local processes: postgres
      -- publishes on 127.0.0.1 only, but "localhost" resolves to ::1 first on
      -- macOS. See preferIPv4Loopback.
      return [restartable $ "blockapps-vault-wrapper-server --pghost " ++ preferIPv4Loopback flags_pghost ++ " --password " ++ pgPassword ++ " --port 8093 --vaultPasswordFile secrets/vault_password +RTS -T -RTS"]
    else return []

  coreCommands <- if not (roleRunsCore role) then return [] else do
    -- The sequencer and vm-runner carry multi-GB heaps during catch-up, so
    -- their RTS flags are sized to this machine (or container limit) instead of
    -- being hard-coded. Sizing happens here, once, at setup time: resizing a
    -- node means re-running strato-setup or editing commands.txt.
    resources <- detectMachineResources
    (sequencerRts, seqNote) <- rtsWithOverride "STRATO_SEQUENCER_RTS" $
      sequencerRtsFlags (mrCores resources) (mrMemMB resources)
    (vmRunnerRts, vmNote) <- rtsWithOverride "STRATO_VMRUNNER_RTS" $
      vmRunnerRtsFlags (mrCores resources) (mrMemMB resources)
    let sizingReport =
          [ "RTS sizing: " ++ describeMachineResources resources ]
          ++ seqNote ++ vmNote ++
          [ "strato-sequencer: " ++ sequencerRts
          , "vm-runner: " ++ vmRunnerRts
          ]
    mapM_ (putStrLn . ("  " ++)) sizingReport
    -- Persist the decision where support can find it later: setup's terminal
    -- output is gone by the time anyone asks why a node runs with these flags.
    writeFile ("logs" </> "rts-sizing.log") (unlines sizingReport)
    when (mrMemMB resources <= smallestRamTierMB) $
      putStrLn $ "\ESC[1;33mWarning: " ++ show (mrMemMB resources) ++ " MB RAM is not enough "
        ++ "for from-genesis sync (vm-runner live data alone is ~3.5GB). "
        ++ "Restore this node from a snapshot instead (strato-up --snapshot).\ESC[0m"
    -- A follower core (an RPC cell) runs the whole pipeline but its sequencer
    -- never votes, proposes or drives round changes, even if its key is in
    -- the validator set.
    let followerFlag = if flags_validatorBehavior then "" else " --validatorBehavior=false"
    return $
      [ restartable "ethereum-discover +RTS -T -RTS"
      , "strato-p2p +RTS -T -RTS"
      , "strato-sequencer " ++ sequencerRts ++ followerFlag
      , "vm-runner " ++ vmRunnerRts
      , restartable ("strato-indexer" ++ (if flags_writer then "" else " --writer=false"))
      , restartable "slipstream +RTS -T -RTS"
      , restartable "strato-network-monitor"
      ]
      -- With a message bus, the pre-sequencer forwards its transactions here.
      ++ [restartable "strato-ingest +RTS -T -RTS" | not (null flags_busHost)]

  let apiCommands
        | roleRunsApi role =
            restartable "strato-api +RTS -T -N -maxN4 -RTS"
              : [restartable "ethereum-jsonrpc +RTS -T -N -maxN4 -RTS" | flags_jsonrpc]
              ++ [restartable "vm-query serve +RTS -T -N -maxN4 -RTS" | flags_vmQuery]
        | otherwise = []

      commonCommands = [restartable "strato-logrotate"]

  writeFile "commands.txt" $ unlines (localAuthCommands ++ coreCommands ++ apiCommands ++ commonCommands)

-- | The computed RTS flags for a process, unless its escape-hatch env var is
-- set, in which case the env var's value is used verbatim (wrapped in
-- +RTS/-RTS). Lets support tune a misbehaving node without a rebuild.
-- Returns the rendered flags plus a report line when an override is in effect.
rtsWithOverride :: String -> [String] -> IO (String, [String])
rtsWithOverride envVar computed = do
  mOverride <- lookupEnv envVar
  return $ case mOverride of
    Just override | not (null override) ->
      ( renderRtsFlags [override]
      , [envVar ++ " override in effect, replacing computed RTS flags"]
      )
    _ -> (renderRtsFlags computed, [])



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
  let regenerate = nodeExists && flags_regenerate
  when (nodeExists && not flags_regenerate) $ do
    when hasFlags $ liftIO $
      putStrLn $ "\ESC[1;33mWarning: Node already exists at " ++ nodeDir ++ ". Flags are ignored. To recreate, stop the node and remove the directory first; to re-point an existing node (e.g. at a managed Postgres), pass --regenerate with the original flags plus the changes.\ESC[0m"
    liftIO $ putStrLn $ "Node already exists at " ++ nodeDir ++ ", skipping setup."

  -- --regenerate keeps everything stateful (LevelDB, genesis, secrets) and
  -- rewrites only what setup derives from flags. The network identity is the
  -- one thing a forgotten flag would silently change, so it is checked.
  when regenerate $ do
    existing <- liftIO $ YAML.decodeFileThrow (".ethereumH" </> "ethconf.yaml")
    let oldNet = EC.networkConfig (existing :: EC.EthConf)
        oldId = (EC.network oldNet, EC.networkID oldNet, EC.chainId oldNet)
        newId = flagsNetworkIdentity
    when (oldId /= newId) $
      liftIO $ error $ "--regenerate would change the network identity from " ++ show oldId
        ++ " to " ++ show newId ++ "; pass the original --network"
    liftIO $ putStrLn $ "Re-generating configuration for existing directory: " ++ nodeDir

  unless (nodeExists && not flags_regenerate) $ do
    let role = currentRole
    liftIO $ putStrLn $ "Setting up STRATO " ++ roleName role ++ ": " ++ nodeDir
    liftIO $ putStrLn $ "  Network: " ++ network
    when (role /= RoleNode && flags_localAuth) $
      liftIO $ error "--localAuth is only supported with --role=node"
    when (role /= RoleNode && flags_dockerMode == "allDocker") $
      liftIO $ error "--dockerMode=allDocker is only supported with --role=node; use docker-compose.api.yml for a containerized API tier"

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
    let coreDirs = ["postgres", "redis", "prometheus"] ++ brokerVolumeDirs
    liftIO $ mapM_ (createDirectoryIfMissing True) $
      ["logs", "secrets", ".ethereumH"]
        ++ (if roleRunsCore role then coreDirs else [])

    -- Make logs directory world-writable for containers running as non-root users (e.g. prometheus)
    liftIO $ setFileMode "logs" (ownerModes .|. groupModes .|. otherModes)

    -- Make the streaming broker's data directories writable by the container's
    -- built-in user. The apache/kafka image runs as its baked-in "appuser"
    -- (uid 1000) and writes its data into the bind-mounted broker dir
    -- (KAFKA_LOG_DIRS). strato-init creates that dir owned by the host login
    -- user; when the host uid is not 1000 (e.g. some Oracle Cloud VMs) appuser
    -- cannot write it and the broker only starts if forced to run as root.
    -- A non-root strato-init cannot chown the dir to uid 1000, so we relax its
    -- mode instead - the same approach already used for "logs" above. The
    -- image's own config dir (/opt/kafka/config) is owned by uid 1000, so
    -- running as appuser keeps that writable without any root privileges.
    --
    -- NOTE: this is scoped to the default Kafka backend, whose brokerVolumeDirs
    -- is just ["kafka"] (a data dir). Other backends selected at build time have
    -- different dirs: the Redpanda/kafka-hw backend runs as the host uid:gid
    -- (bcNeedsUserGid = True), so its dirs are already owned correctly and do
    -- NOT need this; in particular its config dir (redpanda/config) should not
    -- be made world-writable. If that backend ever becomes the default, give it
    -- a narrower treatment instead of relaxing every broker dir here.
    when (roleRunsCore role) $
      liftIO $ mapM_ (\d -> setFileMode d (ownerModes .|. groupModes .|. otherModes)) brokerVolumeDirs

    -- Copy SSL cert and key into the node's secrets/ssl/ directory
    when (not $ null flags_sslDir) $ liftIO $ do
      createDirectoryIfMissing True ("secrets" </> "ssl")
      copyFile (flags_sslDir </> "server.pem") ("secrets" </> "ssl" </> "server.pem")
      copyFile (flags_sslDir </> "server.key") ("secrets" </> "ssl" </> "server.key")
      putStrLn "  ✓ SSL certificate and key installed"

    -- Set postgres password: --password, else the env var, else a random one.
    -- An API directory talks to a core's Postgres, so it must be given that
    -- core's password rather than invent one.
    let pgPasswordFile = "secrets" </> "postgres_password"
    pgPasswordExists' <- doesFileExist pgPasswordFile
    -- An explicit --password replaces the stored one when re-generating
    -- (the point of re-pointing a node at another Postgres).
    let pgPasswordExists = pgPasswordExists' && not (regenerate && not (null flags_password))
    unless pgPasswordExists $ liftIO $ do
      -- The stored file is read-only; make it writable before replacing it.
      when pgPasswordExists' $ setFileMode pgPasswordFile ownerModes
      envPassword <- lookupEnv "postgres_password"
      password <- case (flags_password, envPassword) of
        (pw, _) | not (null pw) -> return pw
        (_, Just pw) | not (null pw) -> return pw
        _ | role == RoleApi -> error "--role=api needs the core's Postgres password: pass --password or set postgres_password"
          | otherwise -> generatePassword 32
      putStrLn $ "  Creating postgres password file: " ++ pgPasswordFile
      writeFile pgPasswordFile password
      void $ chmod roo pgPasswordFile

    -- Session secret for nginx's encrypted session cookies. Every API-tier
    -- nginx must share it, or a cookie minted by one instance fails to
    -- decrypt on another; on a split deployment it comes from Secrets Manager.
    let sessionSecretFile = "secrets" </> "session_secret"
    sessionSecretExists <- doesFileExist sessionSecretFile
    unless (sessionSecretExists || not (roleRunsApi role)) $ liftIO $ do
      envSecret <- lookupEnv "session_secret"
      secret <- case envSecret of
        Just sec | not (null sec) -> return sec
        _ -> generatePassword 64
      putStrLn $ "  Creating session secret file: " ++ sessionSecretFile
      writeFile sessionSecretFile secret
      void $ chmod roo sessionSecretFile

    when flags_localAuth $ liftIO setupLocalAuthSecrets

    -- OAuth credentials: generate secure local creds for --localAuth,
    -- otherwise copy from ~/.secrets/ (external OAuth mode)
    let destOauth = "secrets" </> "oauth_credentials.yaml"
    destOauthExists <- doesFileExist destOauth
    unless destOauthExists $ liftIO $ do
      if flags_localAuth
        then do
          localHostname <- filter (/= '\n') <$> readProcess "hostname" [] ""
          envClientId <- lookupEnv "OAUTH_CLIENT_ID"
          envClientSecret <- lookupEnv "OAUTH_CLIENT_SECRET"
          clientId <- case envClientId of
            Just cid | not (null cid) -> return cid
            _ -> generateClientId 16
          clientSecret <- case envClientSecret of
            Just cs | not (null cs) -> return cs
            _ -> generatePassword 48
          let ssl = not $ null flags_sslDir
              discoveryUrl = if ssl
                then "https://" ++ localHostname ++ "/auth/.well-known/openid-configuration"
                else "http://" ++ localHostname ++ ":" ++ show flags_httpPort ++ "/auth/.well-known/openid-configuration"
              localOauthConfig = unlines
                [ "discoveryUrl: \"" ++ discoveryUrl ++ "\""
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

    ethconf <- liftIO $ genEthConf role

    let dir = ".ethereumH"
    -- Writable for the rewrite, then back to the world-readable, read-only
    -- mode the containers mounting it expect.
    when regenerate $ liftIO $ setFileMode (dir </> "ethconf.yaml") (ownerReadMode .|. ownerWriteMode .|. groupReadMode .|. otherReadMode)
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
      _ -> generateDockerCompose role

    liftIO $ createCommandsFile role
    liftIO $ putStrLn "  ✓ Generated commands.txt"

    -- Custom genesis support: when genesis.json is pre-placed (e.g. useCustomGenesis=true in
    -- docker-compose for single-node CI/CD builds), read it and populate the LevelDB trie from it.
    -- DO NOT REMOVE this branch — without it, custom genesis nodes crash with "Missing StateRoot".
    genesisExists <- doesFileExist "genesis.json"

    if not (roleRunsCore role)
      then liftIO $ putStrLn "  ✓ API role: no genesis state needed"
      else if regenerate
      then liftIO $ putStrLn "  ✓ Existing chain state kept"
      else if genesisExists
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

    liftIO $ putStrLn $ case role of
      RoleNode -> "Node ready"
      RoleCore -> "Core ready"
      RoleApi -> "API tier ready"

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
