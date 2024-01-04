{-# LANGUAGE Arrows #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

import Control.Arrow
import Control.Lens.Combinators
import Control.Monad
import qualified Data.ByteString.Char8 as C8
import Data.Maybe
import qualified Data.Text as T
import Database.PostgreSQL.Simple hiding (Query)
import Database.PostgreSQL.Simple.SqlQQ
import Database.PostgreSQL.Simple.Transaction
import HFlags
import Opaleye
import qualified Opaleye as O
import Opaleye.Internal.PGTypesExternal
import Opaleye.Internal.QueryArr
import Options
import Strato.Strato23.Crypto
import Strato.Strato23.Database.Create as C
import Strato.Strato23.Database.Tables as TS
import Strato.Strato23.Server.Password
import System.Environment
import System.Exit
import Text.CSV
import Text.Printf

-- This does not work as of now
-- We took out public keys from vault db
-- This logic below is using private key
-- If concerned about old usage, you git log to find the orignal status if this needs to be resurrection
getUserOldKeyQuery :: T.Text -> Query (O.Field PGBytea, O.Field PGBytea, O.Field PGBytea, O.Field PGBytea)
getUserOldKeyQuery username = proc () -> do
  (_, name, _, salt, nonce, encSecKey, address) <- selectTable TS.usersTable -< ()
  restrict -< name .== toFields username
  returnA -< (salt, nonce, encSecKey, address)

q1 :: IO [a] -> IO a
q1 mv = do
  xs <- mv
  case xs of
    [] -> die "no result; expected one"
    _ : _ : _ -> die "multiple results; expected exactly one"
    [x] -> return x

main :: IO ()
main = do
  _ <- $initHFlags "migrate-keys"
  let dbConnectInfo =
        ConnectInfo
          { connectHost = flags_pghost,
            connectPort = read flags_pgport,
            connectUser = flags_pguser,
            connectPassword = flags_password,
            connectDatabase = flags_database
          }
  conn <- connect dbConnectInfo
  withTransactionSerializable conn $ do
    void $ execute_ conn [sql| ALTER TABLE users ADD COLUMN IF NOT EXISTS enc_sec_prv_key bytea; |]
    newPassword <- Password . C8.pack <$> getEnv "SECRET_VAULT_WRAPPER_PASSWORD"
    eCSV <- parseCSVFromFile "/dev/stdin"
    case eCSV of
      Left err -> die $ show err
      Right cs -> forM_ cs $ \case
        [] -> return ()
        [""] -> return ()
        [user, subject] -> do
          let oldPassword = Password $ C8.pack subject
          (salt, nonce, oldkey, addr) <- q1 . runSelect conn . getUserOldKeyQuery $ T.pack user
          newKey <-
            either die return $
              reencryptKey
                (getKeyFromPasswordAndSalt oldPassword salt)
                (getKeyFromPasswordAndSalt newPassword salt)
                nonce
                oldkey
                addr
          void . runUpdate conn $
            Update
              { uTable = TS.usersTable,
                -- Note: These lenses are 1-indexed. Its not a huge problem to set enc_key again,
                -- but it might be confusing why enc_sec_key is not being set.
                uUpdateWith = updateEasy (set _6 (toFields newKey)),
                uWhere = views _2 (.== toFields (T.pack user)),
                uReturning = rCount
              }
        other -> die $ printf "reverting: unanticipated input row: %s" (show other)
    -- Will fail if any of the users were left out of the input
    void $ execute_ conn [sql| ALTER TABLE users ALTER COLUMN enc_sec_prv_key SET NOT NULL; |]
    void $ execute_ conn C.messageTable
    wasSet <- setPassword newPassword conn
    unless (isJust wasSet) $ die "unable to set password (password already set?)"

  putStrLn "Keys migrated successfully"
