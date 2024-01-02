{-# LANGUAGE Arrows #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.Strato.Model.Secp256k1
import Control.Arrow
import Control.Concurrent
import Control.Lens.Combinators
import Control.Monad
import qualified Crypto.Saltine.Core.SecretBox as SB
import qualified Data.ByteString as B
import Data.Int (Int32)
import Data.Maybe
import qualified Data.Text as T
import Database.PostgreSQL.Simple hiding (Query)
import HFlags
import Opaleye hiding (sum)
import Options
import qualified Strato.Strato23.Crypto as VC
import Strato.Strato23.Database.Queries as VQ
import Strato.Strato23.Database.Tables
import qualified Strato.Strato23.Server.Password as VP

-- usage: migrate-salt --pw=<vault_password>

-- the purpose of this script is to reencrypt keys from a STRATO version <6.0 that were
--        encrypted with unique user salts, this time using the global password salt. If some of
--        the keys in the vault were already encryped using the global password salt (i.e. keys
--        created after the upgrade), it will skip those (i.e. it will fail to decrypt them using
--        their user salts).

getUsersQuery :: Connection -> IO [(Int32, B.ByteString, SB.Nonce, B.ByteString)]
getUsersQuery conn = runSelect conn $ proc () -> do
  (userId, _, _, salt, nonce, encKey, _) <- selectTable usersTable -< ()
  returnA -< (userId, salt, nonce, encKey)

main :: IO ()
main = do
  _ <- $initHFlags "migrate-salt"

  let usageMsg = "Usage: migrate-salt --pw=<vault_password>"
  putStrLn usageMsg

  let dbConnectInfo =
        ConnectInfo
          { connectHost = "postgres",
            connectPort = 5432,
            connectUser = "postgres",
            connectPassword = "api",
            connectDatabase = "oauth"
          }
  conn <- connect dbConnectInfo
  let pw = VC.textPassword $ T.pack flags_pw

  -- create the Secretbox.key from the pw and salt/nonce/ciphertext in messages table
  (mMsgLst :: [(B.ByteString, SB.Nonce, B.ByteString)]) <- runSelect conn VQ.getMessageQuery
  pwKey <- case mMsgLst of
    [] -> error "message table is empty, so the password must not be set. Aborting..."
    [(msgSalt, msgNonce, ciphertext)] -> do
      let key = VP.getKeyFromPasswordAndSalt pw msgSalt
      case VC.decrypt key msgNonce ciphertext of
        Just msg | msg == VP.superSecretVaultWrapperMessage -> pure key
        _ -> error "couldn't decrypt the secret message, probably you entered the wrong vault password"
    _ -> error "multiple rows in message table, something is not right"

  -- query all users id, salt, nonce, and the encrypted key
  allUsers <- getUsersQuery conn

  -- decrypt the privkey using the salt,nonce in the table.
  -- then, reencrypt with the global password Secretbox.key and the original user nonce
  let reencrypt :: Int32 -> B.ByteString -> SB.Nonce -> B.ByteString -> Maybe (B.ByteString, Int32)
      reencrypt i salt nonce encKey = do
        let sbKey = VP.getKeyFromPasswordAndSalt pw salt
        decKey <- VC.decryptSecKey sbKey nonce encKey
        let newEncKey = VC.encrypt pwKey nonce (exportPrivateKey decKey)
        pure (newEncKey, i)

  let idsAndNewEncKeys = catMaybes $ map (\(i, s, n, k) -> reencrypt i s n k) allUsers
  forM_ allUsers $ \_ -> forkIO $ (print (show $ pw))
  --forM_ allUsers $ \x -> forkIO $ (print (show $ (\(_, s, _, _) -> (VP.getKeyFromPasswordAndSalt pw s)) x))

  --putStrLn $ (" Garrett was here sbKey") ++ (show VP.getKeyFromPasswordAndSalt pw salt)
  forM_ allUsers $ \x -> forkIO $ (print (show $ (\(i, s, n, k) -> reencrypt i s n k) x))
  putStrLn $ (show $ length idsAndNewEncKeys) ++ " of those keys can be reencrypted"
  putStrLn $ "\nFound " ++ (show $ length allUsers) ++ " keys"
  putStrLn $ (show $ length idsAndNewEncKeys) ++ " of those keys can be reencrypted"

  -- update all the rows with the new encrypted keys
  rowsChanged <-
    return . sum
      =<< mapM
        ( \(newKey, rowId) ->
            runUpdate conn $
              Update
                { uTable = usersTable,
                  uUpdateWith = updateEasy (set _6 (toFields newKey)),
                  uWhere = views _1 (.== toFields rowId),
                  uReturning = rCount
                }
        )
        idsAndNewEncKeys

  putStrLn $ "ok, done. I updated " ++ (show rowsChanged) ++ " keys"
