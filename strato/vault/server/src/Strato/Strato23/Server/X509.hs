{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications    #-}

module Strato.Strato23.Server.X509 where

import           Control.Monad.Reader                  (asks)
import qualified Data.Cache                            as Cache
import           Data.Text                             (Text)
import           BlockApps.X509.Certificate
import           Strato.Strato23.API.Types
import           Strato.Strato23.Monad
import           Strato.Strato23.Crypto
import           Strato.Strato23.Database.Queries      (getUserKeyQuery)
import           UnliftIO



createCertificate 
  :: Text                     -- ^ The user name of the issuer of the new certificate
  -> CreateCertEndpoint         -- ^ The subject of the new certificate and the issuer's certificate
  -> VaultM X509Certificate   -- ^ The new X.509 certificate. N.B. This doesn't register the cert
createCertificate userName CreateCertEndpoint{..} = do
  cache <- asks keyStoreCache
  cachedPk <- liftIO $ Cache.lookup cache userName
  (_,nonce,pKey,_) <- case cachedPk of
    Just (KeyStore a b c d) -> pure (a,b,c,d)
    Nothing -> do
      mpk <- vaultTransaction
           . vaultQueryMaybe
           $ getUserKeyQuery userName
      (a,b,c,d) <- case mpk of
        Just pk -> return pk
        Nothing -> vaultWrapperError $ UserError ("User " <> userName <> " doesn't exist")
      liftIO . Cache.insert cache userName $ KeyStore a b c d
      pure (a,b,c,d)
  -- mIssuer will be the issuer of the new certificate. The issuer is equal to the subject
  -- of the parent certificate.
  let mIssuer = fmap subjectToIssuer $ getCertSubject =<< parentCertificate
  withSecretKey $ \key -> case decryptSecKey key nonce pKey of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just prvKey ->
        case (parentCertificate, mIssuer) of
            (Just parentCert, Just issuer) -> do
                cert <- liftIO $ makeSignedCertWithPrivate Nothing (Just $ parentCert) issuer subject prvKey
                pure cert
            _ -> do   -- We make a self-signed certificate. Here the subject is also the issuer
                let issuer = subjectToIssuer subject
                cert <- liftIO $ makeSignedCertWithPrivate Nothing Nothing issuer subject prvKey
                pure cert


subjectToIssuer :: Subject -> Issuer
subjectToIssuer Subject{..} = Issuer 
  { issCommonName = subCommonName
  , issOrg        = subOrg
  , issUnit       = subUnit
  , issCountry    = subCountry
  }
