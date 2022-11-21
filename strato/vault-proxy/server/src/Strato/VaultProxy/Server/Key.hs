{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.VaultProxy.Server.Key where

import           Data.Text                        (Text)

-- import           Servant.Client --needed for the bouncing service and runClientM
import           Strato.VaultProxy.API
import           Strato.VaultProxy.Monad
-- import           Hflags

--Bounce that request
getKey :: Text -> Maybe Text -> VaultProxyM AddressAndKey
-- getKey headerUserName queryParamUserName =   pure undefined
getKey = pure undefined
  --withSecretKey $ \key -> do
  -- let userName = fromMaybe headerUserName queryParamUserName
  -- (_ :: ByteString, nonce, encKey, _ :: Address) <- toUserError ("User " <> userName <> " doesn't exist")
  --                              . vaultQuery1 $ getUserKeyQuery userName
  -- case decryptSecKey key nonce encKey of
  --   Nothing -> vaultWrapperError IncorrectPasswordError
  --   Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey)

postKey :: Text -> VaultProxyM AddressAndKey
-- postKey userName = pure undefined
postKey = pure undefined
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
getSharedKey = pure undefined
-- withSecretKey $ \key -> do
  -- (_ :: ByteString, nonce, encKey, (_ :: Address)) <- 
  --                         toUserError ("User " <> userName <> " doesn't exist")
  --                         . vaultQuery1 $ getUserKeyQuery userName
  -- case decryptSecKey key nonce encKey of
  --   Nothing -> vaultWrapperError IncorrectPasswordError
  --   Just pKey -> return $ deriveSharedKey pKey otherPub
