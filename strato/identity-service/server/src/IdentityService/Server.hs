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
{-# LANGUAGE TupleSections #-}
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
import Bloc.Client (postBlocTransactionParallel)
import BlockApps.Logging
import BlockApps.Solidity.ArgValue
import BlockApps.X509 hiding (isValid)
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Secp256k1
import Control.Monad.Catch (MonadThrow)
import Control.Monad.Change.Modify
import Control.Monad.Reader
import Control.Monad.Trans.Except
import Data.Aeson hiding (Success)
import qualified Data.ByteString.Lazy as BL
import Data.List (find)
import qualified Data.Map as M
import Data.Maybe (fromMaybe, maybeToList)
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, encodeUtf8)
import Data.Time (getCurrentTime)
import GHC.Generics
import Handlers.Metadata (getMetaDataClient, MetadataResponse(..))
import IdentityProvider.OAuth (getAccessToken, AccessToken(..))
import IdentityService.API
import IdentityService.API.Types
import IdentityService.Server.Types
import Network.HTTP.Client hiding (Proxy)
import qualified Network.HTTP.Client as HTTP (Response)
import Network.HTTP.Client.TLS
import Network.HTTP.Types.Header (hContentType, hAuthorization)
import Network.HTTP.Types.Status
import Servant
import Servant.Client hiding (manager, responseBody)
import Text.Format
import UnliftIO hiding (Handler)

data BinaryOp a b = First a | Second b | Sum a b | Product a b

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

putIdentity ::
  ( MonadUnliftIO m,
    MonadLogger m,
    MonadThrow m,
    HasVault m,
    Accessible IdentityServerData m
  ) =>
  PutIdentityRequest ->
  m PutIdentityResponse
putIdentity (PutIdentityRequest eMsg) = do
  time' <- liftIO getCurrentTime
  let sac = case eMsg of
              Left s -> unsigned s
              Right s -> unsigned $ unsigned s

  sub <- case sac of
    SubjectAndCert s Nothing -> pure s
    SubjectAndCert s (Just c) -> case unsafeGetCertSubjectUndefinedPubKey c of
      Nothing -> throwIO $ IdentityError "Could not decode subject of supplied SSL cert"
      Just s' -> if subCommonName s == subCommonName s'
        then pure s
        else throwIO . IdentityError $ "Common name of subject info did not match common name of supplied SSL cert: " <> T.pack (subCommonName s) <> ", " <> T.pack (subCommonName s')

  let username = T.pack $ subCommonName sub
      addr = fromPublicKey $ subPub sub
  $logInfoS "putIdentity" $ "User " <> (T.pack $ format addr) <> " called POST /identity with username " <> username
  let csvLogMsg =
        T.intercalate
          ","
          [ T.pack $ show time',
            username
          ]
  $logInfoS "putIdentity/csv" csvLogMsg

  cert <- case eMsg of
    Left s@(Signed _ _) -> case recoverAddress s of -- new identity
      Just a | a == fromPublicKey (subPub sub) -> certInCirrus (Sum (subCommonName sub) a) >>= \case
        -- User has no cert, create cert
        [] -> do
          domainValid <- checkDomain (subCommonName sub) (subPub sub)
          if domainValid 
            then createAndRegisterCert sub
            else throwIO $ IdentityError "Public key at metadata endpoint not match one used to sign request"
        certs -> do
          case find (\c -> a == certUserAddress c && username == certCommonName c) certs of 
            Just cert -> return $ certificateString cert -- cert for this user claimed, so just return cert again
            Nothing -> do -- somebody else already claimed common name, or pk associated w/ diff common name
              let err = "One of the following has occurred: "
                      <> "A cert already exists for user address " <> T.pack (show a)
                      <> ". Please register using a different key pair."
                      <> " Or, a cert already exists for username " <> username
                      <> ". Please register using a different username"
                      <> ", or sign the cert subject information with a private key "
                      <> "tied to an existing cert tied to that username."
              $logErrorS "putIdentity" err
              throwIO $ ExistingIdentity err
      Nothing -> do
        let err = "Could not recover address from signature"
        $logErrorS "putIdentity" err
        throwIO $ IdentityError err
      _ -> do
        let err = "Signer does not match public key in Subject"
        $logErrorS "putIdentity" err
        throwIO $ IdentityError err
    Right s'@(Signed s@(Signed _ _) _) -> case (,) <$> (recoverSigned s) <*> (recoverSigned s') of -- existing identity
      Just (existingPK, newPK) | newPK == subPub sub -> do 
        let existingA = fromPublicKey existingPK
            newA = fromPublicKey newPK
        certInCirrus (Second newA) >>= \case
          [] -> certInCirrus (Product (subCommonName sub) existingA) >>= \case
            (c:_) -> do
              let existingCN = (subCommonName <$> getCertSubject (certificateString c))
                  newCN = subCommonName sub
              if existingCN == Just newCN
                then do
                  domainValid <- checkDomain newCN existingPK
                  if domainValid
                    then createAndRegisterCert sub
                    else throwIO $ IdentityError "Public key at metadata endpoint not match one used to sign request"
                else do
                  let err = "Common names do not match between "
                        <> (T.pack $ fromMaybe "" existingCN)
                        <> " in the existing cert, and "
                        <> (T.pack newCN)
                        <> " in the subject info"
                  $logErrorS "putIdentity" err
                  throwIO $ ExistingIdentity err
            _ -> do
              let err = "There is no existing cert for address " <> T.pack (format existingA)
              $logErrorS "putIdentity" err
              throwIO $ IdentityError err
          certs -> case find (\c -> newA == certUserAddress c && username == certCommonName c) certs of 
              Just cert -> return $ certificateString cert
              Nothing -> do 
                let err = "A cert already exists for address " <> T.pack (format newA)
                $logErrorS "putIdentity" err
                throwIO $ ExistingIdentity err
      Nothing -> do
        let err = "Could not recover address from signature"
        $logErrorS "putIdentity" err
        throwIO $ IdentityError err
      _ -> do
        let err = "Signer does not match public key in Subject"
        $logErrorS "putIdentity" err
        throwIO $ IdentityError err
  pure $ PutIdentityResponse cert

checkDomain ::
  ( MonadIO m
  , MonadLogger m
  , MonadThrow m
  ) => 
  String -> 
  PublicKey -> 
  m Bool
checkDomain domain pk = do 
  mgr <- liftIO $ newManager tlsManagerSettings -- MUST BE TLS
  url <- parseBaseUrl $ "https://" <> domain -- MUST BE TLS
  let clientEnv = mkClientEnv mgr url
  eresponse <- liftIO $ runClientM getMetaDataClient clientEnv
  case eresponse of
    Right MetadataResponse{nodePubKey = pk'} -> return $ pk == pk'
    Left clienterr -> do
      $logErrorS "checkDomain" $
        T.pack $ "Error while attempting to call metadata data endpoint of domain " <> domain <> ": " <> show clienterr
      throwIO $ IdentityError "Failed to reach metadata endpoint"

blocEndpoint :: String
blocEndpoint = "/bloc/v2.2"

data CertificateInCirrus = CertificateInCirrus
  { certCommonName :: T.Text,
    certificateString :: X509Certificate,
    certUserAddress :: Address,
    isValid :: Bool
  }
  deriving (Show, Generic)

instance FromJSON CertificateInCirrus where
  parseJSON = withObject "CertificateInCirrus" $ \v -> do
    commonName <- v .: "commonName"
    certString <- v .: "certificateString"
    userAddress <- v .: "userAddress"
    valid <- v .: "isValid"
    return $ CertificateInCirrus commonName (either (error . show) id (bsToCert $ encodeUtf8 certString)) userAddress valid

instance ToJSON CertificateInCirrus

certInCirrus ::
  ( MonadIO m
  , MonadLogger m
  , Accessible IdentityServerData m
  ) =>
  BinaryOp String Address ->
  m [CertificateInCirrus]
certInCirrus op = do
  IdentityServerData{nodeUrl = nurl1, tokenEndpoint = te, clientId = ci, clientSecret = cs} <- access (Proxy @IdentityServerData)
  mToken <- getAccessToken ci cs te
  response1 <- callCirrus nurl1 mToken
  mCerts :: Either String [CertificateInCirrus] <-
    if statusCode (responseStatus response1) == 200
      then return . eitherDecode $ responseBody response1
      else do
        let err = "Cirrus did not return a 200 status code when requesting certs"
        $logErrorS "certInCirrus" err
        $logErrorS "certInCirrus" . T.pack . show $ statusCode (responseStatus response1)
        throwIO $ IdentityError err
  case mCerts of
    Right certs -> do
      $logInfoS "certInCirrus" $ T.pack $ "Checked for user's cert in Cirrus; response was: " <> show certs
      return certs
    Left str -> do
      $logErrorS "certInCirrus" . T.pack $ "Unexpected response from cirrus query: " ++ str
      throwIO $ IdentityError . T.pack $ "Unexpected response from cirrus query: " ++ str
  where
    cirrusBasePath = "/cirrus/search/Certificate"
    restOfQuery = "&order=block_timestamp.desc"
    cirrusSearchPath :: BinaryOp String Address -> String
    cirrusSearchPath (First username) =
      cirrusBasePath <> "?commonName=eq." <> username <> restOfQuery
    cirrusSearchPath (Second address) =
      cirrusBasePath <> "?userAddress=eq." <> show address <> restOfQuery
    cirrusSearchPath (Sum username address) = jointQuery "or" username address
    cirrusSearchPath (Product username address) = jointQuery "and" username address
    jointQuery opStr username address = concat
      [ cirrusBasePath
      , "?"
      , opStr
      , "=(commonName.eq."
      , username
      , ",userAddress.eq."
      , show address
      , ")"
      , restOfQuery
      ]

    callCirrus :: (MonadIO m, MonadLogger m) => BaseUrl -> Maybe AccessToken -> m (HTTP.Response BL.ByteString)
    callCirrus nurl mToken = do
      let cirrusEndpoint = cirrusSearchPath op
          url = showBaseUrl nurl {baseUrlPath = baseUrlPath nurl <> cirrusEndpoint}
      $logErrorS "callCirrus" . T.pack $ cirrusEndpoint
      $logErrorS "callCirrus" . T.pack $ url
      mgr <- liftIO $ case baseUrlScheme nurl of
        Http -> newManager defaultManagerSettings
        Https -> newManager tlsManagerSettings
      request <- liftIO $ parseRequest url
      let rHead = [(hContentType, "application/json")] ++ maybeToList ( ((hAuthorization, ) .  encodeUtf8 . T.append "Bearer " . access_token) <$> mToken )
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
  IdentityServerData{nodeUrl = nurl, tokenEndpoint = te, clientId = ci, clientSecret = cs} <- access (Proxy @IdentityServerData)
  mgr <- liftIO $ case baseUrlScheme nurl of
    Http -> newManager defaultManagerSettings
    Https -> newManager tlsManagerSettings
  mToken <- getAccessToken ci cs te
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
      postBlocTx = runClientM (postBlocTransactionParallel ((T.append "Bearer " . access_token) <$> mToken) Nothing Nothing True False txRequest)
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

getUsernameAvailable :: 
  ( MonadIO m,
    MonadLogger m,
    Accessible IdentityServerData m
  ) =>
  GetUsernameAvailableRequest -> m Bool
getUsernameAvailable (GetUsernameAvailableRequest username) = 
  certInCirrus (First username) >>= \case
    [] -> return True
    _ -> throwIO $ ExistingIdentity "username not available to claim"

server ::
  ( MonadUnliftIO m,
    MonadLogger m,
    MonadThrow m,
    HasVault m,
    Accessible IdentityServerData m
  ) =>
  ServerT IdentityServiceAPI m
server = getPingIdentity :<|> putIdentity :<|> getUsernameAvailable

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
        Left e -> do
          liftIO . putStrLn $
              "Error thrown: "
                ++ show e
          throwE $ reThrowError e
    runM' :: ReaderT IdentityServerData (LoggingT IO) x -> IO x
    runM' = runLoggingT . flip runReaderT idData
    reThrowError :: IdentityError -> ServerError
    reThrowError =
      \case
        IdentityError err -> err400 {errBody = BL.fromStrict $ encodeUtf8 err}
        ExistingIdentity err -> err422 {errBody = BL.fromStrict $ encodeUtf8 err}

identityServiceApp ::
  IdentityServerData ->
  Application
identityServiceApp idData =
  serve (Proxy :: Proxy IdentityServiceAPI) $ hoistCoreServer idData
