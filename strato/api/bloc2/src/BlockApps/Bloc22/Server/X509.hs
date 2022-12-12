{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications    #-}
{-# LANGUAGE FlexibleContexts    #-}


module BlockApps.Bloc22.Server.X509 (
    createCertificate
  ) where

import           Data.ByteString
import           Data.Maybe
import           Data.Text                              (Text)
import           SQLM                                   -- For the error handling
import           Strato.Strato23.API.Types
import           Strato.Strato23.Client
import           UnliftIO

import           BlockApps.Bloc22.API.X509
import           BlockApps.Bloc22.Monad
import           BlockApps.Logging
import           BlockApps.X509.Certificate
import           Control.Monad.Composable.SQL
import           Control.Monad.Composable.Vault


createCertificate 
  :: (MonadIO m, MonadLogger m, HasVault m, HasSQL m) -- HasSQL is included for some sensible error handling
  => Text                 -- ^ The user name of the issuer of the new certificate
  -> CreateCertEndpoint   -- ^ The subject of the new certificate and the issuer's certificate
  -> m X509Certificate    -- ^ The new X.509 certificate. N.B. This doesn't register the cert
createCertificate userName CreateCertEndpoint{..} = do
  let mIssuer = fmap subjectToIssuer $ getCertSubject =<< parentCertificate
      -- Make a self-signed cert if no parentCert is provided
      issuer = fromMaybe (subjectToIssuer subject) mIssuer
  mSignedCert <- makeSignedCertSigF (signViaVault userName) Nothing parentCertificate issuer subject
  case mSignedCert of
    Just signedCert -> return signedCert
    Nothing -> throwIO $ UserError "Certificate could not be signed!"

signViaVault :: (MonadIO m, MonadLogger m, HasVault m) => Text -> ByteString -> m Signature 
signViaVault userName bs = blocVaultWrapper $ postSignature' userName Nothing (MsgHash bs)

subjectToIssuer :: Subject -> Issuer
subjectToIssuer Subject{..} = Issuer 
  { issCommonName = subCommonName
  , issOrg        = subOrg
  , issUnit       = subUnit
  , issCountry    = subCountry
  }
