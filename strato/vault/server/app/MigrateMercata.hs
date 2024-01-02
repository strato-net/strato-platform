{-# LANGUAGE Arrows #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.Strato.Model.Secp256k1
import Control.Arrow
import Control.Lens.Combinators
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

getUsersQuery :: Connection -> IO [(Int32, B.ByteString, SB.Nonce, B.ByteString)]
getUsersQuery conn = runSelect conn $ proc () -> do
  (userId, _, _, salt, nonce, encKey, _) <- selectTable usersTable -< ()
  returnA -< (userId, salt, nonce, encKey)

main :: IO ()
main = do
  _ <- $initHFlags "mercata-migrate"
  putStrLn "Usage: mercata-migrate --pw=<vault_password>  pwOld=<vault_password> --indexToStartAt=<shared_vault_largest_index_prior_to_import>"

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
  let pwOld = VC.textPassword $ T.pack flags_pwOld
  let indexToStartAt = (fromIntegral flags_indexToStartAt) :: Int32

  (mMsgLst :: [(B.ByteString, SB.Nonce, B.ByteString)]) <- runSelect conn VQ.getMessageQueryAll
  -- <<<<<<< HEAD
  --   -- let [(_, _, _), (globaOldSalt, _, _)] = mMsgLst -- make this a case statement that throws an error if not two tripules
  --   let globaOldSalt = case mMsgLst of
  --         [] -> error "message table is empty, so the password must not be set. Aborting..."
  --         [(_, _, _), (globaOldSalt',_,_)] -> globaOldSalt'
  --         _ -> error ("Not right number of  rows in message table, something is not right" ++ (show  $ length mMsgLst ))
  -- =======

  -- >>>>>>> 981604e9536c3af74e1fdd2c800d25cb80fffdb3
  pwKey <- case mMsgLst of
    [] -> error "message table is empty, so the password must not be set. Aborting..."
    [(msgSalt, msgNonce, ciphertext), (_, _, _)] -> do
      let key = VP.getKeyFromPasswordAndSalt pw msgSalt
      case VC.decrypt key msgNonce ciphertext of
        Just msg | msg == VP.superSecretVaultWrapperMessage -> pure key
        _ -> error "couldn't decrypt the secret message, probably you entered the wrong vault password"
    _ -> error ("Not right number of  rows in message table, something is not right" ++ (show $ length mMsgLst))

  pwKey' <- case mMsgLst of
    [] -> error "message table is empty, so the password must not be set. Aborting..."
    [(_, _, _), (msgSalt, msgNonce, ciphertext)] -> do
      let key = VP.getKeyFromPasswordAndSalt pwOld msgSalt
      case VC.decrypt key msgNonce ciphertext of
        Just msg | msg == VP.superSecretVaultWrapperMessage -> pure key
        _ -> error "couldn't decrypt the secret message, probably you entered the wrong vault password"
    _ -> error ("Not right number of  rows in message table, something is not right" ++ (show $ length mMsgLst))

  allUsers <- getUsersQuery conn

  let reencrypt :: Int32 -> B.ByteString -> SB.Nonce -> B.ByteString -> Maybe (B.ByteString, Int32)
      reencrypt i _ nonce encKey = do
        decKey <- VC.decryptSecKey pwKey' nonce encKey
        let newEncKey = VC.encrypt pwKey nonce (exportPrivateKey decKey)
        pure (newEncKey, i)

  let allIdsAndNewEncKeys = catMaybes $ map (\(i, s, n, k) -> reencrypt i s n k) allUsers

  let idsAndNewEncKeys = filter (\(_, i) -> i > indexToStartAt) allIdsAndNewEncKeys

  putStrLn $ (show $ length idsAndNewEncKeys) ++ " of those keys can be reencrypted"
  putStrLn $ "\nFound " ++ (show $ length allUsers) ++ " keys"

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
