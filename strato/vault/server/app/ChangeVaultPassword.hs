{-# LANGUAGE Arrows #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

-- |
-- change-vault-password
--
-- Rotates the global vault encryption password by re-encrypting every
-- users.enc_sec_prv_key row and rewriting the message row in a single
-- serializable transaction. Does NOT take backups, does NOT restart the
-- vault container, and does NOT POST the new password to the vault.
--
-- Operator responsibilities before running:
--   - Take a pg_dump backup of the vault database.
--
-- Operator responsibilities after running:
--   - Restart the vault container so its in-memory key is cleared.
--   - POST the new password to /strato/v2.3/password.
--
-- Exit codes:
--   0 - success
--   1 - failure (no DB changes; transaction rolled back)

import Control.Arrow
import Control.Exception (SomeException, bracket, try)
import Control.Monad
import qualified Crypto.Saltine.Class as Saltine
import qualified Crypto.Saltine.Core.SecretBox as SecretBox
import qualified Data.ByteString.Char8 as C8
import Data.Int (Int32)
import Database.PostgreSQL.Simple hiding (Query)
import Database.PostgreSQL.Simple.SqlQQ
import Database.PostgreSQL.Simple.Transaction
import HFlags
import Opaleye hiding (Field, Table, max, min, not, null)
import qualified Options
import Strato.Strato23.Crypto
import Strato.Strato23.Database.Queries (getMessageQuery)
import Strato.Strato23.Database.Tables as TS
import Strato.Strato23.Server.Password (getKeyFromPasswordAndSalt, superSecretVaultWrapperMessage)
import System.Environment (lookupEnv)
import System.Exit (ExitCode (..), exitWith)
import System.IO (BufferMode (..), hFlush, hPutStrLn, hSetBuffering, stderr, stdout)

-- Number of random user rows to decrypt with the new key before committing,
-- as a sanity check that the re-encryption worked end-to-end.
sampleCheckCount :: Int
sampleCheckCount = 10

main :: IO ()
main = do
  hSetBuffering stdout LineBuffering
  hSetBuffering stderr LineBuffering
  _ <- $initHFlags "change-vault-password"

  oldPwBs <- requireEnv "OLD_VAULT_PASSWORD"
  newPwBs <- requireEnv "NEW_VAULT_PASSWORD"
  when (oldPwBs == newPwBs) $ die_ "OLD_VAULT_PASSWORD and NEW_VAULT_PASSWORD must differ"

  skipConfirm <- (Just "1" ==) <$> lookupEnv "CHANGE_VAULT_PASSWORD_YES"
  runRotate oldPwBs newPwBs skipConfirm

requireEnv :: String -> IO C8.ByteString
requireEnv name =
  lookupEnv name >>= \case
    Nothing -> die_ $ "missing required environment variable: " <> name
    Just "" -> die_ $ "environment variable is empty: " <> name
    Just s -> pure (C8.pack s)

connectInfo :: ConnectInfo
connectInfo =
  ConnectInfo
    { connectHost = Options.flags_pghost,
      connectPort = read Options.flags_pgport,
      connectUser = Options.flags_pguser,
      connectPassword = Options.flags_password,
      connectDatabase = Options.flags_database
    }

runRotate :: C8.ByteString -> C8.ByteString -> Bool -> IO ()
runRotate oldPwBs newPwBs skipConfirm = do
  let oldPw = Password oldPwBs
      newPw = Password newPwBs

  bracket (connect connectInfo) close $ \conn -> do
    _ <- (query_ conn [sql| SELECT 1 |] :: IO [Only Int])
    putStrLn "DB connection OK."

    (oldSalt, oldMsgNonce, oldEncMsg) <- loadMessage conn
    let oldKey = getKeyFromPasswordAndSalt oldPw oldSalt
    case decrypt oldKey oldMsgNonce oldEncMsg of
      Just msg | msg == superSecretVaultWrapperMessage -> pure ()
      _ -> die_ "OLD_VAULT_PASSWORD does not match the vault's stored message; aborting."
    putStrLn "Old password validated against message row."

    [Only (userCount :: Int)] <- query_ conn [sql| SELECT count(*) FROM users |]
    putStrLn $ "Users to re-encrypt: " <> show userCount

    unless skipConfirm $ do
      putStrLn ""
      putStrLn "REMINDER: take a pg_dump backup BEFORE confirming. This tool does not."
      putStr "Type ROTATE to continue: "
      hFlush stdout
      l <- getLine
      unless (l == "ROTATE") $ die_ "aborted by user"

    (newSalt, newMsgNonce) <- newSaltAndNonce
    let newKey = getKeyFromPasswordAndSalt newPw newSalt
        newEncMsg = encrypt newKey newMsgNonce superSecretVaultWrapperMessage

    eRot <- try $
      withTransactionSerializable conn $ do
        void $ execute_ conn [sql| LOCK TABLE users IN ACCESS EXCLUSIVE MODE |]
        void $ execute_ conn [sql| LOCK TABLE message IN ACCESS EXCLUSIVE MODE |]

        rows <- runSelect conn $ proc () -> do
          (uid, _, _, _, nonce, encSk, _) <- selectTable TS.usersTable -< ()
          returnA -< (uid, nonce, encSk)

        let total = length rows
        putStrLn $ "Re-encrypting " <> show total <> " user keys..."
        forM_ (zip [(1 :: Int) ..] rows) $ \(i, (uid, nonce, encSk)) -> do
          newRowNonce <- SecretBox.newNonce
          plain <- case decrypt oldKey nonce encSk of
            Just p -> pure p
            Nothing -> fail $ "decrypt failed for user id=" <> show (uid :: Int32)
          let ct = encrypt newKey newRowNonce plain
          void $
            execute
              conn
              [sql| UPDATE users SET nonce = ?, enc_sec_prv_key = ? WHERE id = ? |]
              (Binary (Saltine.encode newRowNonce), Binary ct, uid)
          when (i `mod` 500 == 0) $ putStrLn $ "  ... " <> show i <> "/" <> show total

        void $
          execute
            conn
            [sql| UPDATE message SET salt = ?, nonce = ?, enc_msg = ? WHERE id = 1 |]
            (Binary newSalt, Binary (Saltine.encode newMsgNonce), Binary newEncMsg)

        -- Self-check: re-derive key from message row, decrypt the canonical plaintext.
        (chkSalt, chkNonce, chkCt) <- loadMessage conn
        let chkKey = getKeyFromPasswordAndSalt newPw chkSalt
        case decrypt chkKey chkNonce chkCt of
          Just m | m == superSecretVaultWrapperMessage -> pure ()
          _ -> fail "self-check failed: cannot decrypt message row with new password"

        -- Sample-check N random user rows to ensure they were rewritten correctly.
        let n = Prelude.max 0 (Prelude.min sampleCheckCount total)
        when (n > 0) $ do
          sampleRows <-
            query
              conn
              [sql| SELECT id, nonce, enc_sec_prv_key FROM users ORDER BY random() LIMIT ? |]
              (Only n)
          forM_ (sampleRows :: [(Int32, Binary C8.ByteString, Binary C8.ByteString)]) $
            \(uid, Binary nb, Binary ctb) -> do
              rnonce <- case Saltine.decode nb of
                Just nn -> pure nn
                Nothing -> fail $ "sample-check: bad nonce on user id=" <> show uid
              case decrypt chkKey rnonce ctb of
                Just _ -> pure ()
                Nothing -> fail $ "sample-check: decrypt failed for user id=" <> show uid

        putStrLn "Self-check passed; committing."

    case eRot of
      Left (e :: SomeException) -> die_ $ "rotation aborted, no changes committed: " <> show e
      Right () -> do
        putStrLn "DB rotation committed."
        putStrLn ""
        putStrLn "Next steps (manual):"
        putStrLn "  1. Restart the vault container so its in-memory key is cleared."
        putStrLn "  2. POST the new password to /strato/v2.3/password."

loadMessage :: Connection -> IO (C8.ByteString, SecretBox.Nonce, C8.ByteString)
loadMessage conn = do
  rs <- runSelect conn getMessageQuery
  case rs of
    [r] -> pure r
    [] -> die_ "message table is empty; vault has never had a password set"
    _ -> die_ "message table has more than one row; refusing to proceed"

die_ :: String -> IO a
die_ msg = do
  hPutStrLn stderr $ "ERROR: " <> msg
  exitWith (ExitFailure 1)
