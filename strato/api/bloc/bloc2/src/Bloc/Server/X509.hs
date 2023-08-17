{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Bloc.Server.X509
  ( createCertificate,
  )
where

-- For the error handling

import Bloc.API.X509
import Bloc.Monad
import BlockApps.Logging
import BlockApps.X509.Certificate
import Control.Monad.Composable.Vault
import Data.ByteString
import Data.Maybe
import Data.Text (Text)
import SQLM
import Strato.Strato23.API.Types
import Strato.Strato23.Client
import UnliftIO

createCertificate ::
  (MonadIO m, MonadLogger m, HasVault m) =>
  -- | The user name of the issuer of the new certificate
  Text ->
  -- | The subject of the new certificate and the issuer's certificate
  CreateCertEndpoint ->
  -- | The new X.509 certificate. N.B. This doesn't register the cert
  m X509Certificate
createCertificate userName CreateCertEndpoint {..} = do
  let mIssuer = fmap subjectToIssuer $ getCertSubject =<< parentCertificate
      -- Make a self-signed cert if no parentCert is provided
      issuer = fromMaybe (subjectToIssuer subject) mIssuer
  mSignedCert <- makeSignedCertSigF (signViaVault userName) Nothing parentCertificate issuer subject
  case mSignedCert of
    Just signedCert -> return signedCert
    Nothing -> throwIO $ UserError "Certificate could not be signed!"

signViaVault :: (MonadIO m, MonadLogger m, HasVault m) => Text -> ByteString -> m Signature
signViaVault userName bs = blocVaultWrapper $ postSignature (Just userName) (MsgHash bs)

subjectToIssuer :: Subject -> Issuer
subjectToIssuer Subject {..} =
  Issuer
    { issCommonName = subCommonName,
      issOrg = subOrg,
      issUnit = subUnit,
      issCountry = subCountry
    }
