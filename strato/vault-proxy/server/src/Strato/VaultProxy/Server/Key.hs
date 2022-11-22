{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE TupleSections     #-}

module Strato.VaultProxy.Server.Key where

import           Control.Monad.IO.Class
import           Control.Monad.Trans.RWS.CPS
import           Data.Text                        (Text)

import           Servant.Client --needed for the bouncing service and runClientM
import           Strato.VaultProxy.API
import           Strato.VaultProxy.Monad
import           Strato.VaultProxy.API.Token       as Tok
import           Strato.VaultProxy.DataTypes       as DT

-- import           Hflags

--Bounce that request
getKey :: Text -> Maybe Text -> VaultProxyM AddressAndKey
-- getKey headerUserName queryParamUserName =   pure undefined
getKey headerUsername queryParamUserName = do
  vaultConn <- ask
  let (url,_,_,mgr,_,_,_,_,_,_,_,_,_,_,_) = vaultConn
  nk <- runClientM (Tok.getCurrentUser) (mkClientEnv mgr url)
  nodeKey <- case (nk) of
    Left err -> error $ "Failed to connect to the vault proxy to get the node's name " <> show err
    Right key -> return key
  kii <- liftIO $ runClientM (getKey nodeKey Nothing) (mkClientEnv mgr url)
  key <- case kii of
    Left err -> error $ "Error connecting to the shared vault: " ++ show err
    Right k -> return k
  pure key
  --withSecretKey $ \key -> do
  -- let userName = fromMaybe headerUserName queryParamUserName
  -- (_ :: ByteString, nonce, encKey, _ :: Address) <- toUserError ("User " <> userName <> " doesn't exist")
  --                              . vaultQuery1 $ getUserKeyQuery userName
  -- case decryptSecKey key nonce encKey of
  --   Nothing -> vaultWrapperError IncorrectPasswordError
  --   Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey)

postKey :: Text -> VaultProxyM AddressAndKey
-- postKey userName = pure undefined
postKey userName = do 
  vaultConn <- ask
  let (url,_,_,mgr,_,_,_,_,_,_,_,_,_,_,_) = vaultConn
  nk <- runClientM (Tok.getCurrentUser) (mkClientEnv mgr url)
  nodeKey <- case (nk) of
    Left err -> error $ "Failed to connect to the vault proxy to get the node's name " <> show err
    Right key -> return key
  kii <- runClientM (postKey nodeKey) (mkClientEnv mgr url) --TODO: need to figure out how to pass the vaultproxy config to this function instead of clientEnv
  key <- case kii of
    Left err -> error $ "Error connecting to the shared vault: " ++ show err
    Right k -> return k
  pure key
  -- withSecretKey $ \key -> do
  -- keyStore@KeyStore{..} <- newKeyStore key
  -- created <- vaultModify $ postUserKeyQuery userName keyStore
  -- if not created
  --   then vaultWrapperError $ UserError ("User " <> userName <> " already exists")
  --   else case decryptSecKey key keystoreAcctNonce keystoreAcctEncSecKey of
  --     Nothing -> vaultWrapperError IncorrectPasswordError
  --     Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey)


-- Get an ECDH shared secret from the user's private key and a supplied public key
getSharedKey :: Text -> PublicKey -> VaultProxyM SharedKey
-- getSharedKey userName otherPub = pure undefined
getSharedKey userName otherPub = do
  vaultConn <- ask
  let (url,_,_,mgr,_,_,_,_,_,_,_,_,_,_,_) = vaultConn
  kii <- runClientM (getSharedKey userName otherPub) (mkClientEnv mgr url) --TODO: need to figure out how to pass the vaultproxy config to this function instead of clientEnv
  key <- case kii of
    Left err -> error $ "Error connecting to the shared vault: " ++ show err
    Right k -> return k
  pure key
-- withSecretKey $ \key -> do
  -- (_ :: ByteString, nonce, encKey, (_ :: Address)) <- 
  --                         toUserError ("User " <> userName <> " doesn't exist")
  --                         . vaultQuery1 $ getUserKeyQuery userName
  -- case decryptSecKey key nonce encKey of
  --   Nothing -> vaultWrapperError IncorrectPasswordError
  --   Just pKey -> return $ deriveSharedKey pKey otherPub
