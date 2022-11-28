{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE TupleSections     #-}

module Strato.VaultProxy.Server.Password where

-- import           Control.Monad.IO.Class
-- import           Control.Monad.Reader

import           Control.Monad.Trans.Reader
import qualified Crypto.KDF.Scrypt                 as Scrypt
import qualified Crypto.Saltine.Core.SecretBox     as SecretBox
import qualified Crypto.Saltine.Class              as Saltine
import qualified Crypto.Saltine.Internal.ByteSizes as Saltine
-- import           Data.ByteString                   (ByteString)
import           Data.ByteString.Char8             as B
import           Data.Maybe                       (fromMaybe, fromJust)
-- import           Data.IORef
import           Data.Text                        as T
import qualified Data.Text.Encoding               as TE
-- import           GHC.Conc
-- import           Network.HTTP.Client              as HTC
-- import           Database.PostgreSQL.Simple       (Connection)
import           Network.HTTP.Req                 as R
import           Strato.VaultProxy.Crypto
import           Strato.VaultProxy.Monad
import           Strato.VaultProxy.DataTypes
import           Strato.VaultProxy.Server.Token
-- import           Servant.Client
import qualified Text.URI                          as URI

superSecretVaultProxyMessage :: ByteString
superSecretVaultProxyMessage =
  "A monad is just a monoid in the category of endofunctors, what's the problem?"

getKeyFromPasswordAndSalt :: Password -> ByteString -> SecretBox.Key
getKeyFromPasswordAndSalt (Password pw) salt = 
  let scryptParams = Scrypt.Parameters
        { Scrypt.n = 16384
        , Scrypt.r = 8
        , Scrypt.p = 1
        , Scrypt.outputLength = Saltine.secretBoxKey
        }
  in fromMaybe (error "could not decode encryption key") . Saltine.decode $
     Scrypt.generate scryptParams pw salt


-- setPassword :: Password -> Connection -> IO (Maybe SecretBox.Key)
-- setPassword pw conn = do
--   (salt, nonce) <- newSaltAndNonce
--   let key = getKeyFromPasswordAndSalt pw salt
--   let ciphertext = encrypt key
--                            nonce
--                            superSecretVaultProxyMessage
--   success <- postMessageQuery salt nonce ciphertext conn
--   if success
--     then return $ Just key
--     else return Nothing


postPassword :: Text -> VaultProxyM ()
-- postPassword password = pure undefined
postPassword password = do
    --Get the VaultConnection information
  vaultConn <- ask
  --Make the url for getting the key
  let urlEncodedPart = ReqBodyUrlEnc $ "password" =: password
      url = (vaultUrl vaultConn) <> "/password"
  uri <- URI.mkURI url
  --Make the other pieces that are needed to connect to the shared vault
  let (ur,_) = fromJust (useHttpsURI $ uri)
  --Get the jwt token from the vaultProxy
  jwt <- vaulty vaultConn
  --Make the jwt header to allow for the connecting of the foreign vault
  let authHeadr = R.header (B.pack "Bearer") (TE.encodeUtf8 $ T.pack $ show jwt)
  --make a req request to the shared vault
  makeHttpCall <- runReq defaultHttpConfig $ do
    response <- R.req R.POST ur urlEncodedPart jsonResponse (authHeadr)
    pure $ R.responseBody response
  --Convert the response to the correct type automatically
  pure makeHttpCall
  --
  -- vaultConn <- ask
  -- let url = vaultUrl vaultConn
  --     mgr = httpManager vaultConn
  --     clientEnv = ClientEnv mgr url
  -- kii <- runClientM (postPassword password) clientEnv --TODO: need to figure out how to pass the vaultproxy config to this function instead of clientEnv
  -- key <- case kii of
  --   Left err -> error $ "Error connecting to the shared vault: " ++ show err
  --   Right k -> return k
  -- pure key
--   do
--   existingKey <- asks superSecretKey
--   doIAlreadyHaveAKey <- liftIO $ readIORef existingKey

--   case doIAlreadyHaveAKey of
--     Just _ -> vaultProxyError $ UserError "Password is already set"
--     Nothing -> do
--       mMsg <- listToMaybe <$> vaultQuery getMessageQuery
--       case mMsg of
--         Nothing -> do
--           maybeKey <- vaultModify . setPassword $ Password $ encodeUtf8 password
--           case maybeKey of
--             Just key -> liftIO . atomicWriteIORef existingKey $ Just key
--             Nothing -> vaultWrapperError $ AnError "Failed to insert encrypted message into database"
--         Just (salt :: ByteString, nonce, ciphertext) -> do
--           let key = getKeyFromPasswordAndSalt (Password $ encodeUtf8 password) salt
--           case decrypt key nonce ciphertext of
--             Just msg | msg == superSecretVaultWrapperMessage ->
--               liftIO . atomicWriteIORef existingKey $ Just key
--             _ -> vaultWrapperError $ UserError "Could not validate password"

---TODO: This will not work once the migration for the vault proxy is complete
verifyPassword :: VaultProxyM Bool
verifyPassword = do
    --Get the VaultConnection information
  vaultConn <- ask
  let url = (vaultUrl vaultConn) <> "/verify-password"
  uri <- URI.mkURI url
  --Make the other pieces that are needed to connect to the shared vault
  let (ur,_) = fromJust (useHttpsURI $ uri)
  jwt <- vaulty vaultConn
  --Make the jwt header to allow for the connecting of the foreign vault
  let authHeadr = R.header (B.pack "Bearer") (TE.encodeUtf8 $ T.pack $ show jwt)
  --make a req request to the shared vault
  makeHttpCall <- runReq defaultHttpConfig $ do
    response <- R.req R.GET ur NoReqBody jsonResponse (authHeadr)
    pure $ R.responseBody response
  --Convert the response to the correct type automatically
  pure makeHttpCall
  --
  -- vaultConn <- ask
  -- let url = vaultUrl vaultConn
  --     mgr = httpManager vaultConn
  --     clientEnv = ClientEnv mgr url
  -- kii <- runClientM (postPassword password) clientEnv --TODO: need to figure out how to pass the vaultproxy config to this function instead of clientEnv
  -- key <- case kii of
  --   Left err -> error $ "Error connecting to the shared vault: " ++ show err
  --   Right k -> return k
  -- pure key
  -- vaultConn <- ask
  -- let url = vaultUrl vaultConn
  --     mgr = httpManager vaultConn
  --     clientEnv = ClientEnv mgr url
  -- kii <- runClientM (verifyPassword) clientEnv
  -- key <- case kii of
  --   Left err -> error $ "Error connecting to the shared vault: " ++ show err
  --   Right k -> return k
  -- pure key
  -- -- do 
  -- existingKey <- asks superSecretKey
  -- doIAlreadyHaveAKey <- liftIO $ readIORef existingKey
  -- return $ isJust doIAlreadyHaveAKey
  
