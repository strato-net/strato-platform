{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}

{-# OPTIONS -fno-warn-orphans #-}

import Blockchain.Data.RLP (RLPSerializable)
import BlockApps.X509.Certificate -- (Subject(..))
import BlockApps.X509.Keys (bsToPriv)
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1 hiding (HasVault)
import Control.Monad
import Control.Monad.Change.Modify
import Control.Monad.Composable.Vault
import Control.Monad.IO.Class (liftIO, MonadIO)
import Control.Monad.Trans.Reader
import Data.Aeson (encode)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import qualified Data.ByteString.Char8 as C8
import Data.Proxy()
import HFlags
import Servant.Client
import SignSubjectOptions
import Strato.Strato23.API.Types
import Strato.Strato23.Client (postSignature, getKey)
import System.IO
  ( BufferMode (..),
    hSetBuffering,
    stderr,
    stdout,
  )

 -- call POST /signature to vault proxy 
 -- need url to vault-proxy
instance Monad m => Accessible VaultData (VaultM m) where
  access _ = ask

main :: IO ()
main = do
  forM_ [stdout, stderr] $ flip hSetBuffering LineBuffering
  _ <- $initHFlags "Subject signing tool"
  emSslCert <- if flags_ssl_cert_file == ""
    then pure $ Right Nothing
    else fmap Just . bsToCert <$> B.readFile flags_ssl_cert_file
  case emSslCert of
    Left err -> error $ "Could not decode ssl cert: " ++ err
    Right mSslCert -> do
      pub <- case flags_public_key of
        "" -> do -- signing own subject info
          runVaultM flags_vault_proxy $ getVaultKey >>= \case
            Just pk -> return pk
            Nothing -> error "could not GET /key from vault-proxy"
        mp  -> case importPublicKey $ C8.pack mp of
          Nothing -> error $ "Could not decode public key from " ++ mp
          Just p -> return p -- signing somebody else's subject info
      let ou = if flags_organizationUnit == "" then Nothing else Just flags_organizationUnit
          c = if flags_country == "" then Nothing else Just flags_country
          mSslSub = unsafeGetCertSubjectUndefinedPubKey =<< mSslCert
          sub = Subject
                  (maybe flags_commonName subCommonName mSslSub)
                  (maybe flags_organization subOrg mSslSub)
                  (maybe ou subUnit mSslSub)
                  (maybe c subCountry mSslSub)
                  pub
          sac = SubjectAndCert sub mSslCert
          printS = putStrLn . C8.unpack . BL.toStrict . encode
      case flags_verification_key of
        "" -> do -- new identity
          mSig <- signWithVault sac
          case mSig of
            Just sig -> do 
              let signed = Signed sac sig
              printS signed
            Nothing -> error "Could not call POST /signature endpoint on vault-proxy"
        filename -> do -- existing identity
          pkBS' <- B.readFile filename
          let ePK' = bsToPriv pkBS'
          case ePK' of
            Left err -> error $ "Could not decode verification private key: " ++ err
            Right pk -> do
              let sig' = signWithRawKey pk sac
              let signedSub = Signed sac sig'
              signWithVault signedSub >>= \case
                Just sig -> do 
                  let signed = Signed signedSub sig
                  printS signed
                Nothing -> error "Could not call POST /signature endpoint on vault-proxy"

eitherToMaybe :: Either a b -> Maybe b
eitherToMaybe (Left _) = Nothing
eitherToMaybe (Right x) = Just x

signWithRawKey :: (RLPSerializable r) => PrivateKey -> r -> Signature
signWithRawKey p = signMsg p . keccak256ToByteString . rlpHash

signWithVault :: (MonadIO m, RLPSerializable r) => r -> m (Maybe Signature)
signWithVault = runVaultM flags_vault_proxy . postVaultSig . keccak256ToByteString . rlpHash

postVaultSig :: (MonadIO m, HasVault m) => C8.ByteString -> m (Maybe Signature)
postVaultSig h = do
  VaultData url mgr <- access Proxy
  res <- liftIO $ runClientM (postSignature Nothing (MsgHash h)) (mkClientEnv mgr url)
  return $ eitherToMaybe res

getVaultKey :: (MonadIO m, HasVault m) => m (Maybe PublicKey)
getVaultKey = do
  VaultData url mgr <- access Proxy
  res <- liftIO $ runClientM (getKey Nothing Nothing) (mkClientEnv mgr url)
  return $ unPubKey <$> eitherToMaybe res