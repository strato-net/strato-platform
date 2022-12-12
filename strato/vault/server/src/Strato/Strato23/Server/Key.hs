{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Strato23.Server.Key where

import           Data.ByteString (ByteString)
import           Data.Maybe                       (fromMaybe, fromJust)
import           Data.Text                        (Text)
import           Strato.Strato23.API
import           Strato.Strato23.Crypto
import           Strato.Strato23.Monad
import qualified Crypto.Saltine.Core.SecretBox  as SecretBox
import           Strato.Strato23.Database.Queries
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Secp256k1


getKey :: Text -> Maybe Text -> Maybe Text -> VaultM AddressAndKey
getKey headerUserName  mHeaderOauthProvider queryParamUserName = withSecretKey $ \key -> do
  case mHeaderOauthProvider of 
    Just headerOauthProvider -> getKey' headerUserName headerOauthProvider queryParamUserName
    Nothing -> do
        let userName = fromMaybe headerUserName queryParamUserName
        (_ :: ByteString, nonce, encKey, _ :: Address) <- toUserError ("User " <> userName <> " doesn't exist")
                                    . vaultQuery1 $ getUserKeyQuery userName
        case decryptSecKey key nonce encKey of
          Nothing -> vaultWrapperError IncorrectPasswordError
          Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey)

getKey' :: Text -> Text -> Maybe Text -> VaultM AddressAndKey
getKey' headerUserName headerOauthProvider queryParamUserName = withSecretKey $ \key -> do
  let userName = fromMaybe headerUserName queryParamUserName
  (_ :: ByteString, nonce, encKey, _ :: Address) <- toUserError ("User " <> userName <> " doesn't exist")
                               . vaultQuery1 $ getUserKeyQuery' userName headerOauthProvider
  case decryptSecKey key nonce encKey of
    Nothing   -> vaultWrapperError IncorrectPasswordError
    Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey)

getKeys' :: Text -> Text -> Maybe Text -> VaultM [AddressAndKey]
getKeys' _ _ queryParamUserName = withSecretKey $ \key -> do
  let userName = fromJust queryParamUserName
  ls :: [( ByteString, SecretBox.Nonce, ByteString,  Address)]    <-  toUserError ("User " <> userName <> " doesn't exist") . vaultQueryMany $ getUserKeyQuery userName               
  let decryptHelper nonce encKey = 
        case decryptSecKey key nonce encKey of
            Nothing   -> vaultWrapperError IncorrectPasswordError
            Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey) 
  sequence $ map (\(_, noncee, encKeyy, _ ) ->  decryptHelper noncee encKeyy) ls
  

postKey :: Text ->  Maybe Text -> VaultM AddressAndKey
postKey userName oauthProvider_ = withSecretKey $ \key -> do
  keyStore@KeyStore{..} <- newKeyStore key
  case oauthProvider_ of 
    Nothing -> vaultWrapperError $ UserError ("User " <> userName <> "with no Oauth provider was given")
    Just oauthProvider -> do
      created <- vaultModify $ postUserKeyQuery' userName oauthProvider keyStore
      if not created
        then vaultWrapperError $ UserError ("User " <> userName <> oauthProvider <> " already exists")
        else case decryptSecKey key keystoreAcctNonce keystoreAcctEncSecKey of
          Nothing -> vaultWrapperError IncorrectPasswordError
          Just pKey -> return $ AddressAndKey (fromPrivateKey pKey) (derivePublicKey pKey)


-- Get an ECDH shared secret from the user's private key and a supplied public key
getSharedKey :: Text -> PublicKey -> VaultM SharedKey
getSharedKey userName otherPub = withSecretKey $ \key -> do
  (_ :: ByteString, nonce, encKey, (_ :: Address)) <- 
                          toUserError ("User " <> userName <> " doesn't exist")
                          . vaultQuery1 $ getUserKeyQuery userName
  case decryptSecKey key nonce encKey of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just pKey -> return $ deriveSharedKey pKey otherPub

-- Get an ECDH shared secret from the user's private key and a supplied public key
-- This needs to change 
getSharedKey' :: Text ->  Maybe Text ->  PublicKey -> VaultM SharedKey
getSharedKey' userName mOauthProvider otherPub = withSecretKey $ \key -> do
  case mOauthProvider of 
    Nothing -> getSharedKey userName otherPub
    Just oauthProvider -> do 
        (_ :: ByteString, nonce, encKey, (_ :: Address)) <- 
                                toUserError ("User " <> userName <> " " <> oauthProvider<> " doesn't exist")
                                . vaultQuery1 $ getUserKeyQuery' userName oauthProvider
        case decryptSecKey key nonce encKey of
          Nothing -> vaultWrapperError IncorrectPasswordError
          Just pKey -> return $ deriveSharedKey pKey otherPub
