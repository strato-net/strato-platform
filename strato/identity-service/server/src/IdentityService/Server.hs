{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PolyKinds #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module IdentityService.Server
  ( module IdentityService.Server.Types
  , identityServiceApp
  ) where

import Bloc.API.Transaction
import Bloc.API.Users
import Bloc.Client (postBlocTransactionParallelExternal)
import BlockApps.Logging
import BlockApps.Solidity.ArgValue
import BlockApps.X509 hiding (isValid)
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Secp256k1
import Control.Monad.Change.Modify
import Control.Monad.Reader
import Control.Monad.Trans.Except
import Data.Aeson hiding (Success)
import qualified Data.ByteString.Lazy as BL
import qualified Data.Map as M
import Data.Maybe (fromMaybe)
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, encodeUtf8)
import Data.Time (getCurrentTime)
import IdentityService.API
import IdentityService.API.Types
import IdentityService.Server.Types
import Network.HTTP.Client hiding (Proxy)
import qualified Network.HTTP.Client as HTTP (Response)
import Network.HTTP.Client.TLS
import Network.HTTP.Types.Header (hContentType)
import Network.HTTP.Types.Status
import Servant
import Servant.Client hiding (manager, responseBody)
import Text.Format
import UnliftIO hiding (Handler)

instance Monad m => HasVault (ReaderT IdentityServerData m) where
  sign msg = do
    pk <- asks issuerPrivKey
    pure $ signMsg pk msg
  getPub = do
    pk <- asks issuerPrivKey
    pure $ derivePublicKey pk
  getShared _ = error "The Identity Server should not need to create a shared key"

getPingIdentity :: (MonadIO m) => m Int
getPingIdentity = return 1

postIdentity ::
  ( MonadUnliftIO m,
    MonadLogger m,
    HasVault m,
    Accessible IdentityServerData m
  ) =>
  PostIdentityRequest ->
  m PostIdentityResponse
postIdentity (PostIdentityRequest eMsg) = do
  time' <- liftIO getCurrentTime
  let sub = case eMsg of
              Left s -> unsigned s
              Right s -> unsigned $ unsigned s
      username = T.pack $ subCommonName sub
      addr = fromPublicKey $ subPub sub
  $logInfoS "postIdentity" $ "User " <> (T.pack $ format addr) <> " called POST /identity with username " <> username
  let csvLogMsg =
        T.intercalate
          ","
          [ T.pack $ show time',
            username
          ]
  $logInfoS "postIdentity/csv" csvLogMsg

  cert <- case eMsg of
    Left s@(Signed _ _) -> case recoverAddress s of -- new identity
      Just a | a == fromPublicKey (subPub sub) -> certInCirrus a >>= \case
        -- User has no cert, create cert
        [] -> do
          cert <- createAndRegisterCert sub
          pure cert
        [cert] -> pure cert
        _ -> do
          $logErrorS "postIdentity" "Yikes! How can we have multiple certs if we're only limiting the search to one?"
          throwIO $ IdentityError "Something is wrong. Have a network administrator look into this."
      Nothing -> do
        let err = "Could not recover address from signature"
        $logErrorS "postIdentity" err
        throwIO $ IdentityError err
      _ -> do
        let err = "Signer does not match public key in Subject"
        $logErrorS "postIdentity" err
        throwIO $ IdentityError err
    Right s'@(Signed s@(Signed _ _) _) -> case (,) <$> (recoverAddress s) <*> (recoverAddress s') of -- existing identity
      Just (existingA, newA) | newA == fromPublicKey (subPub sub) -> certInCirrus newA >>= \case
        [] -> certInCirrus existingA >>= \case
          (c:_) -> do
            let existingCN = (subCommonName <$> getCertSubject c)
                newCN = subCommonName sub
            if existingCN == Just newCN
              then createAndRegisterCert sub
              else do
                let err = "Common names do not match between "
                       <> (T.pack $ fromMaybe "" existingCN)
                       <> " in the existing cert, and "
                       <> (T.pack newCN)
                       <> " in the subject info"
                $logErrorS "postIdentity" err
                throwIO $ IdentityError err
          _ -> do
            let err = "There is no existing cert for address " <> T.pack (format existingA)
            $logErrorS "postIdentity" err
            throwIO $ IdentityError err
        _ -> do
          let err = "A cert already exists for address " <> T.pack (format newA)
          $logErrorS "postIdentity" err
          throwIO $ IdentityError err
      Nothing -> do
        let err = "Could not recover address from signature"
        $logErrorS "postIdentity" err
        throwIO $ IdentityError err
      _ -> do
        let err = "Signer does not match public key in Subject"
        $logErrorS "postIdentity" err
        throwIO $ IdentityError err
  pure $ PostIdentityResponse cert

blocEndpoint :: String
blocEndpoint = "/bloc/v2.2"

certInCirrus ::
  ( MonadIO m
  , MonadLogger m
  , Accessible IdentityServerData m
  ) =>
  Address ->
  m [X509Certificate]
certInCirrus a = do
  nurl1 <- nodeUrl <$> access (Proxy @IdentityServerData)
  response1 <- callCirrus nurl1
  mCerts :: Maybe [X509Certificate] <-
    if statusCode (responseStatus response1) == 200
      then return . decode $ responseBody response1
      else do
        let err = "Cirrus did not return a 200 status code when requesting certs"
        $logErrorS "certInCirrus" err
        throwIO $ IdentityError err
  case mCerts of
    Just certs -> do
      $logInfoS "certInCirrus" $ T.pack $ "Checked for user's cert in Cirrus; response was: " <> show certs
      return certs -- maybe can also check if cert is valid and matches user attributes
    Nothing -> do
      $logErrorS "certInCirrus" "Unexpected response from cirrus query. This should never happen"
      throwIO $ IdentityError "Unable to decode cirrus query for user's cert. Something went very wrong"
  where
    cirrusSearchPath :: Address -> String
    cirrusSearchPath address =
      "/cirrus/search/Certificate?userAddress=eq." <> show address <> "&order=block_timestamp.desc&limit=1"

    callCirrus :: MonadIO m => BaseUrl -> m (HTTP.Response BL.ByteString)
    callCirrus nurl = do
      let cirrusEndpoint = cirrusSearchPath a
          url = showBaseUrl nurl {baseUrlPath = baseUrlPath nurl <> cirrusEndpoint}
      mgr <- liftIO $ case baseUrlScheme nurl of
        Http -> newManager defaultManagerSettings
        Https -> newManager tlsManagerSettings
      request <- liftIO $ parseRequest url
      let rHead = [(hContentType, "application/json")]
      liftIO $ httpLbs request {requestHeaders = rHead} mgr

createAndRegisterCert ::
  ( MonadIO m,
    MonadLogger m,
    HasVault m,
    Accessible IdentityServerData m
  ) =>
  Subject ->
  m X509Certificate
createAndRegisterCert sub = do
  createNewCert sub >>= \case
    Just newCert -> newCert <$ registerCert newCert
    Nothing -> do
      $logErrorS "createAndRegisterCert" . T.pack $ "Error occurred while trying to sign a cert for user " ++ (subCommonName sub)
      throwIO $ IdentityError "Unable to sign new cert for user"

createNewCert ::
  ( MonadIO m,
    HasVault m,
    Accessible IdentityServerData m
  ) =>
  Subject ->
  m (Maybe X509Certificate)
createNewCert sub = do
  IdentityServerData{issuer = i, issuerCert = c} <- access (Proxy @IdentityServerData)
  makeSignedCertSigF sign Nothing (Just c) i sub

registerCert ::
  ( MonadIO m
  , MonadLogger m
  , Accessible IdentityServerData m
  ) =>
  X509Certificate ->
  m ()
registerCert cert = do
  IdentityServerData{nodeUrl = nurl} <- access (Proxy @IdentityServerData)
  mgr <- liftIO $ case baseUrlScheme nurl of
    Http -> newManager defaultManagerSettings
    Https -> newManager tlsManagerSettings
  let clientEnv = mkClientEnv mgr nurl {baseUrlPath = baseUrlPath nurl <> blocEndpoint}
      txPayload =
        BlocFunction
          FunctionPayload
            { functionpayloadContractAddress = 0x509,
              functionpayloadMethod = "registerCertificate",
              functionpayloadArgs = M.singleton "newCertificateString" (ArgString . decodeUtf8 $ certToBytes cert),
              functionpayloadValue = Nothing,
              functionpayloadTxParams = Nothing,
              functionpayloadChainid = Nothing,
              functionpayloadMetadata = Nothing
            }
      txRequest = PostBlocTransactionRequest Nothing [txPayload] Nothing Nothing
      postBlocTx = runClientM (postBlocTransactionParallelExternal Nothing Nothing Nothing True False txRequest)
  eresponse <- liftIO $ postBlocTx clientEnv
  case eresponse of
    Right response ->
      if all txSuccess response
        then $logInfoS "registerCert" $ T.pack $ "Response after registering cert was: " ++ show response
        else do
          $logErrorS "registerCert" $ T.pack $ "Failed to register cert for user; response was: " ++ show response
          throwIO $ IdentityError "Failed to register cert"
    Left clienterr -> do
      $logErrorS "registerCert" $
        T.pack $
          "Attempting to register on fallback node because recieved the following error when registering cert: "
            ++ show clienterr
      throwIO $ IdentityError "Failed to register cert"

txSuccess :: BlocChainOrTransactionResult -> Bool
-- txSuccess BlocTxResult (BlocTransactionResult{blocTransactionStatus = stat}) | stat /= Failure = True
-- instead of this?
txSuccess (BlocTxResult BlocTransactionResult {blocTransactionStatus = Success}) = True
txSuccess _ = False

server ::
  ( MonadUnliftIO m,
    MonadLogger m,
    HasVault m,
    Accessible IdentityServerData m
  ) =>
  ServerT IdentityServiceAPI m
server = getPingIdentity :<|> postIdentity

hoistCoreServer ::
  IdentityServerData ->
  Server IdentityServiceAPI
hoistCoreServer idData =
  hoistServer (Proxy :: Proxy IdentityServiceAPI) (convertErrors runM') server
  where
    convertErrors r x = Handler $ do
      eRes <- liftIO . try $ r x
      case eRes of
        Right a -> return a
        Left e -> throwE $ reThrowError e
    runM' :: ReaderT IdentityServerData (LoggingT IO) x -> IO x
    runM' = runLoggingT . flip runReaderT idData
    reThrowError :: IdentityError -> ServerError
    reThrowError =
      \case
        IdentityError err -> err400 {errBody = BL.fromStrict $ encodeUtf8 err}

identityServiceApp ::
  IdentityServerData ->
  Application
identityServiceApp idData =
  serve (Proxy :: Proxy IdentityServiceAPI) $ hoistCoreServer idData
