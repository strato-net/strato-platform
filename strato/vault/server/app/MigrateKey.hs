{-# LANGUAGE Arrows #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

-- |
-- migrate-key
--
-- Move a single user's key between two Vault instances (different DBs,
-- different vault passwords) without ever writing the plaintext private
-- key to disk.
--
-- Two modes, chosen by which of --out / --in is provided:
--
--   --out=<path>  EXPORT mode
--     Reads the user's encrypted key from the configured Postgres DB
--     (decrypting it with the current vault password), then re-encrypts
--     it under a one-time transport password and writes the result to
--     <path> as a JSON envelope.
--
--   --in=<path>   IMPORT mode
--     Reads the JSON envelope, decrypts it with the transport password,
--     re-encrypts under the destination vault password, and inserts a
--     new user row in the configured destination Postgres DB.
--
-- Passwords are read from stdin (two lines, newline-separated). They are
-- never accepted on the command line or via environment variables.
--   EXPORT: line 1 = current vault password, line 2 = transport password
--   IMPORT: line 1 = transport password,    line 2 = destination vault password
--
-- Exit codes:
--   0 - success
--   1 - failure (on import, the destination DB transaction is rolled back)

import Control.Arrow
import Control.Exception (SomeException, bracket, try)
import Control.Monad (unless, when)
import qualified Crypto.Saltine.Class as Saltine
import qualified Crypto.Saltine.Core.SecretBox as SecretBox
import Data.Aeson ((.:), (.=))
import qualified Data.Aeson as A
import qualified Data.Aeson.Types as A
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base64 as B64
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Lazy as BL
import Data.Int (Int32)
import qualified Data.Text as T
import qualified Data.Text.Encoding as T
import Database.PostgreSQL.Simple hiding (Query)
import Database.PostgreSQL.Simple.SqlQQ
import Database.PostgreSQL.Simple.Transaction
import HFlags
import Opaleye hiding (Field, Table, max, min, not, null)
import qualified Options
import Strato.Strato23.Crypto
import Strato.Strato23.Database.Queries (getMessageQuery, postUserKeyQuery')
import Strato.Strato23.Database.Tables as TS
import Strato.Strato23.Server.Password (getKeyFromPasswordAndSalt, superSecretVaultWrapperMessage)
import Blockchain.Strato.Model.Address (formatAddressWithoutColor, fromPrivateKey, stringAddress)
import Blockchain.Strato.Model.Secp256k1 (exportPrivateKey, importPrivateKey)
import System.Environment (lookupEnv)
import System.Exit (ExitCode (..), exitWith)
import System.IO
  ( BufferMode (..),
    IOMode (..),
    hClose,
    hFlush,
    hGetEcho,
    hIsTerminalDevice,
    hPutStr,
    hPutStrLn,
    hSetBuffering,
    hSetEcho,
    openFile,
    stderr,
    stdin,
    stdout,
  )

defineFlag "out" ("" :: String) "Export mode: path to write the encrypted key envelope to"
defineFlag "in" ("" :: String) "Import mode: path to read the encrypted key envelope from"
defineFlag "x_user_unique_name" ("" :: String) "(export only) x_user_unique_name column value of the user to export"
defineFlag "x_identity_provider_id" ("" :: String) "(export only) x_identity_provider_id column value of the user to export"
defineFlag "force" False "(import only) overwrite an existing user row with the same (x_user_unique_name, x_identity_provider_id)"

envelopeVersion :: Int
envelopeVersion = 1

main :: IO ()
main = do
  hSetBuffering stdout LineBuffering
  hSetBuffering stderr LineBuffering
  _ <- $initHFlags "migrate-key"

  let outPath = flags_out
      inPath = flags_in
  case (null outPath, null inPath) of
    (False, False) -> die_ "exactly one of --out or --in must be provided, not both"
    (True, True) -> die_ "exactly one of --out or --in must be provided"
    (False, True) -> runExport outPath
    (True, False) -> runImport inPath flags_force

-- | Resolve Postgres connection settings using the following precedence:
--
--   1. CLI flag, if the operator passed a value different from the built-in
--      HFlags default (i.e. explicitly overrode it).
--   2. Environment variable (same names the vault-wrapper daemon reads from
--      docker-compose: @postgres_host@, @postgres_port@, @postgres_user@,
--      @postgres_password@, @postgres_vault_wrapper_db@), if set and non-empty.
--   3. The built-in HFlags default from 'Options'.
--
-- This matches the standard Unix CLI > env > default convention while still
-- letting operators run the tool inside an existing vault-wrapper container
-- without re-typing connection settings that are already in its environment.
connectInfo :: IO ConnectInfo
connectInfo = do
  host <- resolve "postgres_host" Options.flags_pghost "postgres"
  portStr <- resolve "postgres_port" Options.flags_pgport "5432"
  user <- resolve "postgres_user" Options.flags_pguser "postgres"
  pw <- resolve "postgres_password" Options.flags_password "api"
  db <- resolve "postgres_vault_wrapper_db" Options.flags_database "oauth"
  pure
    ConnectInfo
      { connectHost = host,
        connectPort = read portStr,
        connectUser = user,
        connectPassword = pw,
        connectDatabase = db
      }
  where
    -- envName: env var name; flagVal: current HFlags value; flagDefault: the
    -- value HFlags would have had if the operator did not pass the flag.
    resolve :: String -> String -> String -> IO String
    resolve envName flagVal flagDefault
      | flagVal /= flagDefault = pure flagVal -- operator explicitly overrode via CLI
      | otherwise = do
          mEnv <- lookupEnv envName
          pure $ case mEnv of
            Just s | not (null s) -> s
            _ -> flagDefault

-- ----------------------------------------------------------------------------
-- Export mode
-- ----------------------------------------------------------------------------

runExport :: String -> IO ()
runExport outPath = do
  when (null flags_x_user_unique_name) $
    die_ "--x_user_unique_name is required in export mode"
  when (null flags_x_identity_provider_id) $
    die_ "--x_identity_provider_id is required in export mode"

  vaultPwBs <- readPasswordLine "Current source vault password: "
  transportPwBs <- readPasswordLine "Transport password (used to protect the export file): "
  when (BS.null vaultPwBs) $ die_ "vault password is empty"
  when (BS.null transportPwBs) $ die_ "transport password is empty"
  when (vaultPwBs == transportPwBs) $
    die_ "vault password and transport password must differ"

  let vaultPw = Password vaultPwBs
      transportPw = Password transportPwBs
      uName = T.pack flags_x_user_unique_name
      uProv = T.pack flags_x_identity_provider_id

  ci <- connectInfo
  bracket (connect ci) close $ \conn -> do
    _ <- (query_ conn [sql| SELECT 1 |] :: IO [Only Int])
    putStrLn "DB connection OK."

    (msgSalt, msgNonce, encMsg) <- loadMessage conn
    let vaultKey = getKeyFromPasswordAndSalt vaultPw msgSalt
    case decrypt vaultKey msgNonce encMsg of
      Just m | m == superSecretVaultWrapperMessage -> pure ()
      _ -> die_ "source vault password does not match the vault's stored message; aborting."
    putStrLn "Source vault password validated."

    -- Look up exactly one row matching (x_user_unique_name, x_identity_provider_id).
    rows <- runSelect conn $ proc () -> do
      (uid, uname, uprov, _salt, nonce, encSk, addrBs) <- selectTable TS.usersTable -< ()
      restrict -< uname .== toFields uName .&& uprov .== toFields uProv
      returnA -< (uid, nonce, encSk, addrBs)
    (uid :: Int32, userNonce :: SecretBox.Nonce, encSecPrvKey :: BS.ByteString, addrBs :: BS.ByteString) <-
      case rows of
        [r] -> pure r
        [] -> die_ "no user matches the given (x_user_unique_name, x_identity_provider_id)"
        _ -> die_ "more than one user matches; refusing to proceed (the UNIQUE constraint should prevent this)"
    putStrLn $ "Found user id=" <> show uid

    plain <- case decrypt vaultKey userNonce encSecPrvKey of
      Just p -> pure p
      Nothing -> die_ "could not decrypt the user's key with the source vault password"

    -- Sanity-check: the recovered private key must produce the stored address.
    privKey <- case importPrivateKey plain of
      Just k -> pure k
      Nothing -> die_ "decrypted bytes are not a valid private key"
    let derivedAddr = fromPrivateKey privKey
        derivedAddrBs = C8.pack (formatAddressWithoutColor derivedAddr)
    when (derivedAddrBs /= addrBs) $
      die_ "address mismatch between decrypted key and DB row; aborting."
    putStrLn "Address self-check passed."

    -- Wrap under the transport password.
    (transportSalt, transportNonce) <- newSaltAndNonce
    let transportKey = getKeyFromPasswordAndSalt transportPw transportSalt
        transportCiphertext = encrypt transportKey transportNonce plain

    let env =
          Envelope
            { envVersion = envelopeVersion,
              envXUserUniqueName = uName,
              envXIdentityProviderId = uProv,
              envAddressHex = T.decodeUtf8 addrBs,
              envTransportSalt = transportSalt,
              envTransportNonce = Saltine.encode transportNonce,
              envTransportCiphertext = transportCiphertext
            }
    writeEnvelope outPath env
    putStrLn $ "OK: wrote encrypted envelope to " <> outPath

-- ----------------------------------------------------------------------------
-- Import mode
-- ----------------------------------------------------------------------------

runImport :: String -> Bool -> IO ()
runImport inPath force = do
  transportPwBs <- readPasswordLine "Transport password (the one used during export): "
  vaultPwBs <- readPasswordLine "Destination vault password: "
  when (BS.null transportPwBs) $ die_ "transport password is empty"
  when (BS.null vaultPwBs) $ die_ "destination vault password is empty"

  let transportPw = Password transportPwBs
      vaultPw = Password vaultPwBs

  env <- readEnvelope inPath
  unless (envVersion env == envelopeVersion) $
    die_ $ "unsupported envelope version: " <> show (envVersion env)

  -- Decrypt the envelope under the transport password.
  transportNonce <- case Saltine.decode (envTransportNonce env) of
    Just n -> pure n
    Nothing -> die_ "envelope transport_nonce is not a valid SecretBox nonce"
  let transportKey = getKeyFromPasswordAndSalt transportPw (envTransportSalt env)
  plain <- case decrypt transportKey transportNonce (envTransportCiphertext env) of
    Just p -> pure p
    Nothing -> die_ "could not decrypt envelope (wrong transport password, or file is corrupted)"

  privKey <- case importPrivateKey plain of
    Just k -> pure k
    Nothing -> die_ "decrypted envelope bytes are not a valid private key"

  -- Address sanity check against the envelope.
  let derivedAddr = fromPrivateKey privKey
      derivedAddrBs = C8.pack (formatAddressWithoutColor derivedAddr)
      claimedAddrBs = T.encodeUtf8 (envAddressHex env)
  when (derivedAddrBs /= claimedAddrBs) $
    die_ "address mismatch between envelope's recorded address and the decrypted key"
  -- Also verify it parses as an Address.
  case stringAddress (T.unpack (envAddressHex env)) of
    Just _ -> pure ()
    Nothing -> die_ "envelope address_hex is not a valid Ethereum address"

  ci <- connectInfo
  bracket (connect ci) close $ \conn -> do
    _ <- (query_ conn [sql| SELECT 1 |] :: IO [Only Int])
    putStrLn "Destination DB connection OK."

    (msgSalt, msgNonce, encMsg) <- loadMessage conn
    let vaultKey = getKeyFromPasswordAndSalt vaultPw msgSalt
    case decrypt vaultKey msgNonce encMsg of
      Just m | m == superSecretVaultWrapperMessage -> pure ()
      _ -> die_ "destination vault password does not match the destination vault's stored message; aborting."
    putStrLn "Destination vault password validated."

    -- Check for an existing user row with the same (name, provider).
    existing <-
      runSelect conn $ proc () -> do
        (uid, uname, uprov, _, _, _, _) <- selectTable TS.usersTable -< ()
        restrict -<
          uname .== toFields (envXUserUniqueName env)
            .&& uprov .== toFields (envXIdentityProviderId env)
        returnA -< uid
    case existing :: [Int32] of
      [] -> pure ()
      (_ : _) ->
        unless force $
          die_ "a user with this (x_user_unique_name, x_identity_provider_id) already exists in the destination DB; re-run with --force to overwrite"

    -- Re-encrypt the plaintext private key under the destination vault key
    -- with a fresh nonce, then write inside a serializable transaction.
    userNonce <- SecretBox.newNonce
    let encSecPrvKey = encrypt vaultKey userNonce (exportPrivateKey privKey)

    eRes <- try $
      withTransactionSerializable conn $ do
        case existing :: [Int32] of
          [] -> do
            -- Insert via the existing helper (uses the per-user salt = msgSalt convention
            -- by reusing the message salt, matching post-MigrateSalt behavior).
            let keystore =
                  KeyStore
                    { keystoreSalt = msgSalt,
                      keystoreAcctNonce = userNonce,
                      keystoreAcctEncSecKey = encSecPrvKey,
                      keystoreAcctAddress = derivedAddr
                    }
            ok <-
              postUserKeyQuery'
                (envXUserUniqueName env)
                (envXIdentityProviderId env)
                keystore
                conn
            unless ok $ fail "insert returned False (user already present?)"
            pure ("inserted" :: String)
          _ -> do
            -- --force overwrite path.
            n <-
              execute
                conn
                [sql|
                  UPDATE users
                  SET salt = ?, nonce = ?, enc_sec_prv_key = ?, address = ?
                  WHERE x_user_unique_name = ? AND x_identity_provider_id = ?
                |]
                ( Binary msgSalt,
                  Binary (Saltine.encode userNonce),
                  Binary encSecPrvKey,
                  Binary derivedAddrBs,
                  envXUserUniqueName env,
                  envXIdentityProviderId env
                )
            when (n /= 1) $ fail $ "UPDATE affected " <> show n <> " rows; expected 1"
            pure "updated"

    case eRes of
      Left (e :: SomeException) -> die_ $ "import aborted, no changes committed: " <> show e
      Right action -> do
        putStrLn $ "OK: " <> action <> " user "
          <> T.unpack (envXUserUniqueName env)
          <> " / "
          <> T.unpack (envXIdentityProviderId env)
          <> " (address "
          <> T.unpack (envAddressHex env)
          <> ")"

-- ----------------------------------------------------------------------------
-- Envelope
-- ----------------------------------------------------------------------------

data Envelope = Envelope
  { envVersion :: Int,
    envXUserUniqueName :: T.Text,
    envXIdentityProviderId :: T.Text,
    envAddressHex :: T.Text,
    envTransportSalt :: BS.ByteString,
    envTransportNonce :: BS.ByteString,
    envTransportCiphertext :: BS.ByteString
  }

instance A.ToJSON Envelope where
  toJSON e =
    A.object
      [ "version" .= envVersion e,
        "x_user_unique_name" .= envXUserUniqueName e,
        "x_identity_provider_id" .= envXIdentityProviderId e,
        "address_hex" .= envAddressHex e,
        "transport_salt_b64" .= b64 (envTransportSalt e),
        "transport_nonce_b64" .= b64 (envTransportNonce e),
        "transport_ciphertext_b64" .= b64 (envTransportCiphertext e)
      ]
    where
      b64 :: BS.ByteString -> T.Text
      b64 = T.decodeUtf8 . B64.encode

instance A.FromJSON Envelope where
  parseJSON = A.withObject "Envelope" $ \o -> do
    v <- o .: "version"
    n <- o .: "x_user_unique_name"
    p <- o .: "x_identity_provider_id"
    a <- o .: "address_hex"
    s <- o .: "transport_salt_b64" >>= b64Field "transport_salt_b64"
    nn <- o .: "transport_nonce_b64" >>= b64Field "transport_nonce_b64"
    c <- o .: "transport_ciphertext_b64" >>= b64Field "transport_ciphertext_b64"
    pure
      Envelope
        { envVersion = v,
          envXUserUniqueName = n,
          envXIdentityProviderId = p,
          envAddressHex = a,
          envTransportSalt = s,
          envTransportNonce = nn,
          envTransportCiphertext = c
        }
    where
      b64Field :: String -> T.Text -> A.Parser BS.ByteString
      b64Field fieldName t =
        case B64.decode (T.encodeUtf8 t) of
          Right bs -> pure bs
          Left err -> fail $ fieldName <> " is not valid base64: " <> err

writeEnvelope :: FilePath -> Envelope -> IO ()
writeEnvelope path env =
  bracket (openFile path WriteMode) hClose $ \h ->
    BL.hPut h (A.encode env)

readEnvelope :: FilePath -> IO Envelope
readEnvelope path = do
  bs <- BL.readFile path
  case A.eitherDecode bs of
    Right e -> pure e
    Left err -> die_ $ "could not parse envelope file: " <> err

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

loadMessage :: Connection -> IO (BS.ByteString, SecretBox.Nonce, BS.ByteString)
loadMessage conn = do
  rs <- runSelect conn getMessageQuery
  case rs of
    [r] -> pure r
    [] -> die_ "message table is empty; vault has never had a password set"
    _ -> die_ "message table has more than one row; refusing to proceed"

-- Read one line from stdin without echo (when stdin is a terminal).
readPasswordLine :: String -> IO BS.ByteString
readPasswordLine prompt = do
  isTty <- hIsTerminalDevice stdin
  if isTty
    then do
      hPutStr stderr prompt
      hFlush stderr
      old <- hGetEcho stdin
      bs <- bracket
        (hSetEcho stdin False)
        (\_ -> hSetEcho stdin old)
        (\_ -> C8.hGetLine stdin)
      hPutStrLn stderr ""
      pure bs
    else C8.hGetLine stdin

die_ :: String -> IO a
die_ msg = do
  hPutStrLn stderr $ "ERROR: " <> msg
  exitWith (ExitFailure 1)
