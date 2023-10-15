{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
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

module IdentityProvider.Server (identityProviderApp) where

import Bloc.API.Transaction
import Bloc.Client
import BlockApps.Logging
import BlockApps.Solidity.ArgValue
import BlockApps.X509 hiding (isValid)
import Blockchain.Strato.Model.Secp256k1 hiding (HasVault)
import Control.Monad.Change.Modify
import Control.Monad.Composable.Vault
import Control.Monad.Reader
import Control.Monad.Trans.Except
import Data.Aeson
import qualified Data.ByteString.Lazy as BL
import Data.List (elemIndex)
import qualified Data.Map as M
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, encodeUtf8)
import GHC.Generics
import qualified IdentityProvider.API as IDAPI
import IdentityProvider.Email
import IdentityProvider.OAuth hiding (issuer)
import Network.HTTP.Client hiding (Proxy)
import qualified Network.HTTP.Client as HTTP (Response)
import Network.HTTP.Client.TLS
import Network.HTTP.Types.Header (hAuthorization, hContentType)
import Network.HTTP.Types.Status
import Servant
import Servant.Client hiding (manager, responseBody)
import Strato.Strato23.API
import Strato.Strato23.Client
import UnliftIO hiding (Handler)

data IdentityError
  = IdentityError Text
  deriving (Show, Exception)

getAccessTokenForRealm ::
  ( MonadIO m,
    MonadLogger m,
    Accessible RealmData m
  ) =>
  String ->
  m (Maybe AccessToken)
getAccessTokenForRealm realm = do
  rd <- access (Proxy @RealmData)
  case M.lookup realm rd of
    Nothing -> do
      $logErrorS "getAccessTokenForRealm" $ "Recieved PUT /identity request from a realm we don't support: " <> T.pack realm
      throwIO $ IdentityError "Identity server does not support this realm"
    Just (RealmDetails endpoints cid csec _ _) -> getAccessToken cid csec (token_endpoint endpoints)

-- oAuthUserToSubject :: OAuthUser -> PublicKey -> Subject
-- oAuthUserToSubject (OAuthUser id' firstN' lastN' attr) pk =
--     let firstN = T.unpack firstN'
--         lastN = T.unpack lastN'
--     in Subject {
--     subCommonName =  firstN <> " " <> lastN,
--     subOrg = case attr of
--         Just (OAuthUserAttributes (Just (org:_))) | not (T.null org) -> T.unpack org
--         _ -> head firstN : lastN ++ T.unpack (T.take 8 id')
--     ,
--     subUnit = Nothing,
--     subCountry = Nothing,
--     subPub = pk
-- }

getDefaultEmptyOrg :: String -> String -> String
getDefaultEmptyOrg name uuid = "Mercata Account " ++ case elemIndex ' ' name of
  Nothing -> head name : take 8 uuid
  Just idx ->
    let lastNs = drop (idx + 1) name
     in head name : lastNs ++ take 8 uuid

getSubject ::
  ( MonadIO m,
    MonadLogger m
  ) =>
  Text ->
  Maybe Text ->
  Text ->
  String ->
  PublicKey ->
  m Subject
getSubject name mCo uuid _ pk
  | not $ T.null name = do
    let name' = T.unpack name
    return
      Subject
        { subCommonName = name',
          subOrg = case mCo of
            Just co | not $ T.null co -> T.unpack co
            _ -> getDefaultEmptyOrg (T.unpack name) (T.unpack uuid),
          subUnit = Nothing,
          subCountry = Nothing,
          subPub = pk
        }
  | otherwise = do
    $logErrorS "getSubject" "Improper query params! Param 'name' is not defined or is empty. Cannot create a cert with so little info"
    throwIO $ IdentityError "Param 'name' cannot be empty"

-- NOTE TO FUTURE DEVELOPERS: This commented-out code block is from a previous flow where we would call
-- the GET /users endpoint on keycloak to get the user's information. We are trying to be less keycloak
-- dependent, so this flow is not being used, but I'll just leave it in here just in case we ever need it

-- getAccessTokenForRealm "master" >>= \case
--     Nothing -> do
--         $logErrorS "createAndRegisterCert" "uh oh! We couldn't get an access token for the master realm"
--         throwIO $ IdentityError "Something is wrong with the provided access credentials for the master realm. Have a network administrator look into this."
--     Just masterToken -> do
--         getUserByUUID masterToken (T.unpack uuid) realm >>= \case
--             Left err -> do
--                 $logErrorS "createAndRegisterCert" $ "Error occurred while querying OAuth server for information on user with uuid " <> uuid <> ": " <> T.pack err
--                 throwIO $ IdentityError "Could not retrieve user's information from OAuth server"
--             Right user -> do
--                 $logInfoS "createAndRegisterCert" $ "The user's info from the OAuth server is " <> T.pack (show user)
--                 return $ oAuthUserToSubject user pk

data IdentityServerData = IdentityServerData
  { issuer :: Issuer, -- issuer of signing cert
    issuerCert :: X509Certificate, -- the signing cert
    issuerPrivKey :: PrivateKey, -- the signing private key
    realmNameToDetails :: RealmData,
    sendgridAPIKey :: Maybe SendgridAPIKey
  }

instance Monad m => Accessible Issuer (ReaderT IdentityServerData m) where
  access _ = asks issuer

instance Monad m => Accessible X509Certificate (ReaderT IdentityServerData m) where
  access _ = asks issuerCert

instance Monad m => Accessible PrivateKey (ReaderT IdentityServerData m) where
  access _ = asks issuerPrivKey

instance Monad m => Accessible RealmData (ReaderT IdentityServerData m) where
  access _ = asks realmNameToDetails

instance Monad m => Accessible (Maybe SendgridAPIKey) (ReaderT IdentityServerData m) where
  access _ = asks sendgridAPIKey

instance Monad m => Accessible VaultData (VaultM m) where
  access _ = ask

instance (Monad m, Accessible VaultData m) => Accessible VaultData (ReaderT IdentityServerData m) where
  access = lift . access

getPingIdentity :: (MonadIO m) => m Int
getPingIdentity = return 1

putIdentity ::
  ( MonadIO m,
    MonadLogger m,
    HasVault m,
    Accessible Issuer m,
    Accessible X509Certificate m,
    Accessible PrivateKey m,
    Accessible RealmData m,
    Accessible (Maybe SendgridAPIKey) m
  ) =>
  Text ->
  Text ->
  Text ->
  Text ->
  Maybe Text ->
  Maybe Text ->
  m Address
putIdentity accessToken uuid idProv name mEmail mCo = do
  $logInfoS "putIdentity" $ "User " <> uuid <> " called PUT /identity with name " <> name <> " and company " <> T.pack (show mCo)
  -- check if a user exists in vault
  let realm = extractRealmName $ T.unpack idProv
      json = T.concat
           [ "{\"user\":\""
           , uuid
           , "\",\"realm\":\""
           , T.pack realm
           , "\",\"name\":\""
           , name
           , maybe "" ("\",\"organization\":\"" <>) mCo
           , "\"}"
           ]
  $logInfoS "putIdentity/json" json
  getVaultKey accessToken >>= \case
    Just (AddressAndKey a k) -> do
      -- has vault key, confirm also has cert
      hasCert <- certInCirrus accessToken realm a (T.unpack name) (T.unpack uuid) (T.unpack <$> mCo)
      unless hasCert $ createAndRegisterCert name mEmail mCo uuid realm k
      return a
    Nothing -> do
      -- no vault key, so make key and register cert
      AddressAndKey a k <- postVaultKey accessToken
      createAndRegisterCert name mEmail mCo uuid realm k
      return a

-- This is just a dummy function
-- This never gets called on the sevrvant backend
-- This is created for the client binding
-- which is used within the strato node to form a request
-- which Identity server's nginx transforms the headers
-- which patterns matches with putIdentity
putIdentityExternal ::
  ( MonadIO m,
    MonadLogger m,
    HasVault m,
    Accessible Issuer m,
    Accessible X509Certificate m,
    Accessible PrivateKey m,
    Accessible RealmData m,
    Accessible (Maybe SendgridAPIKey) m
  ) =>
  Text ->
  m Address
putIdentityExternal bearerToken = putIdentity (T.replace "Bearer " "" bearerToken) "" "" "" Nothing Nothing

blocEndpoint :: String
blocEndpoint = "/bloc/v2.2"

data CertificateInCirrus = CertificateInCirrus
  { -- commonName :: Text,
    -- organization :: Text,
    isValid :: Bool
  }
  deriving (Show, Generic)

instance FromJSON CertificateInCirrus

instance ToJSON CertificateInCirrus

certInCirrus ::
  (MonadIO m, MonadLogger m, Accessible RealmData m) =>
  Text ->
  String ->
  Address ->
  String ->
  String ->
  Maybe String ->
  m Bool
certInCirrus token realm a name uuid mCo = do
  rd <- access (Proxy @RealmData)
  case M.lookup realm rd of
    Nothing -> do
      $logErrorS "certInCirrus" "Trying to find a cert on a network whose realm we don't support (How?? We should never reach this error)"
      throwIO $ IdentityError "Identity server does not support this realm. Error should have been thrown sooner"
    Just (RealmDetails _ _ _ nurl1 nurl2) -> do
      response1 <- callCirrus nurl1
      mCerts :: Maybe [CertificateInCirrus] <-
        if statusCode (responseStatus response1) == 200
          then return . decode $ responseBody response1
          else callCirrus nurl2 >>= return . decode . responseBody
      case mCerts of
        Just certs -> do
          $logInfoS "certInCirrus" $ T.pack $ "Checked for user's cert in Cirrus; response was: " <> show certs
          return . not $ null certs -- maybe can also check if cert is valid and matches user attributes
        Nothing -> do
          $logErrorS "certInCirrus" "Unexpected response from cirrus query. This should never happen"
          throwIO $ IdentityError "Unable to decode cirrus query for user's cert. Something went very wrong"
  where
    cirrusSearchPath :: Address -> String -> String -> Maybe String -> String
    cirrusSearchPath address commonName uuid' mOrg =
      let orgParam = case mOrg of
            Nothing -> ",organization.eq." <> getDefaultEmptyOrg commonName uuid'
            Just "" -> ",organization.eq." <> getDefaultEmptyOrg commonName uuid'
            Just org -> ",organization.eq." <> org
       in "/cirrus/search/Certificate?and=(userAddress.eq." <> show address <> ",commonName.eq." <> commonName <> orgParam <> ")"

    callCirrus :: MonadIO m => BaseUrl -> m (HTTP.Response BL.ByteString)
    callCirrus nurl = do
      let cirrusEndpoint = cirrusSearchPath a name uuid mCo
          url = showBaseUrl nurl {baseUrlPath = baseUrlPath nurl <> cirrusEndpoint}
      mgr <- liftIO $ case baseUrlScheme nurl of
        Http -> newManager defaultManagerSettings
        Https -> newManager tlsManagerSettings
      request <- liftIO $ parseRequest url
      let rHead = [(hContentType, "application/json"), (hAuthorization, encodeUtf8 $ "Bearer " <> token)]
      liftIO $ httpLbs request {requestHeaders = rHead} mgr

createAndRegisterCert ::
  ( MonadIO m,
    MonadLogger m,
    Accessible Issuer m,
    Accessible X509Certificate m,
    Accessible PrivateKey m,
    Accessible RealmData m,
    Accessible (Maybe SendgridAPIKey) m
  ) =>
  Text ->
  Maybe Text ->
  Maybe Text ->
  Text ->
  String ->
  PublicKey ->
  m ()
createAndRegisterCert name mEmail mCo uuid realm k = do
  sub <- getSubject name mCo uuid realm k
  createNewCert sub >>= \case
    Just newCert -> do
      getAccessTokenForRealm realm >>= \case
        Nothing -> do
          $logErrorS "createAndRegisterCert" "uh oh! We couldn't retrieve an access token for our realm"
          throwIO $ IdentityError "Something is wrong with the provided access credentials for the current realm. Have a network administrator look into this."
        Just realmToken -> do
          registerCert newCert realmToken realm
          mEmailK <- access (Proxy @(Maybe SendgridAPIKey))
          case (mEmail, mEmailK) of
            (Just email, Just emailK) -> sendWelcomeEmail (T.unpack email) (T.unpack name) (T.unpack uuid) emailK
            (_, _) -> return ()
    Nothing -> do
      $logErrorS "createAndRegisterCert" $ "Error occurred while trying to sign a cert for user " <> uuid
      throwIO $ IdentityError "Unable to sign new cert for user"

createNewCert ::
  ( MonadIO m,
    Accessible Issuer m,
    Accessible X509Certificate m,
    Accessible PrivateKey m
  ) =>
  Subject ->
  m (Maybe X509Certificate)
createNewCert sub = do
  i <- access (Proxy @Issuer)
  c <- access (Proxy @X509Certificate)
  iK <- access (Proxy @PrivateKey)
  let signWIssuerPrivKey bs = return $ signMsg iK bs
  makeSignedCertSigF signWIssuerPrivKey Nothing (Just c) i sub

registerCert ::
  (MonadIO m, MonadLogger m, Accessible RealmData m) =>
  X509Certificate ->
  AccessToken ->
  String ->
  m ()
registerCert cert token realm = do
  rd <- access (Proxy @RealmData)
  case M.lookup realm rd of
    Nothing -> do
      $logErrorS "registerCert" "Trying to register cert for realm we don't support. Error should have been thrown MUCH sooner"
      throwIO $ IdentityError "Identity server does not support this realm. Error should have been thrown MUCH sooner"
    Just (RealmDetails _ _ _ nurl nurl2) -> do
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
          postBlocTx = runClientM (postBlocTransactionExternal (Just $ "Bearer " <> access_token token) Nothing Nothing True txRequest)
      eresponse <- liftIO $ postBlocTx clientEnv
      case eresponse of
        Right response -> $logInfoS "registerCert" $ T.pack $ "Response after registering cert was: " ++ show response
        Left clienterr -> do
          $logErrorS "registerCert" $
            T.pack $
              "Attempting to register on fallback node because recieved the following error when registering cert on primary node: "
                ++ show clienterr
          mgr2 <- liftIO $ case baseUrlScheme nurl2 of
            Http -> newManager defaultManagerSettings
            Https -> newManager tlsManagerSettings
          let clientEnv2 = mkClientEnv mgr2 nurl2 {baseUrlPath = baseUrlPath nurl2 <> blocEndpoint}
          eresponse2 <- liftIO $ postBlocTx clientEnv2
          $logInfoS "registerCert" $ T.pack $ "Response from fallback node was " ++ show eresponse2

--TODO: how to tell if cert successfully added to blockchain?

getVaultKey :: (MonadIO m, MonadLogger m, HasVault m) => Text -> m (Maybe AddressAndKey)
getVaultKey accessToken = do
  VaultData url mgr <- access Proxy
  eAddressNKey <- liftIO $ runClientM (getKey (Just accessToken) Nothing) (mkClientEnv mgr url)
  case eAddressNKey of
    Right a -> do
      $logInfoS "getVaultKey" $ T.pack $ "User already has key in vault: " <> show a
      return $ Just a
    -- only errors from GET /key are user doesn't exist (400) or incorrect pw (503)
    -- beware if the error behavior for /key changes
    Left (FailureResponse _ Response {..}) | responseStatusCode == status400 -> do
      $logInfoS "getVaultKey" "User has no vault key yet. Will create one now"
      return Nothing
    Left err -> do
      $logInfoS "getVaultKey" $ T.pack $ "Vault error when trying to get user's key: " <> show err
      throwIO $ IdentityError $ T.pack $ "Vault error when trying to get user's key: " <> show err

postVaultKey :: (MonadIO m, MonadLogger m, HasVault m) => Text -> m AddressAndKey
postVaultKey accessToken = do
  VaultData url mgr <- access Proxy
  eAddressNKey <- liftIO $ runClientM (postKey (Just accessToken)) (mkClientEnv mgr url)
  case eAddressNKey of
    Right (AddressAndKey a k) -> do
      $logInfoS "postVaultKey" $ T.pack $ "Successfully posted to vault; address is " <> show a <> " and key is " <> show k
      return (AddressAndKey a k)
    Left err -> do
      $logErrorS "postVaultKey" $ T.pack $ "error posting user's pubkey: " <> show err
      throwIO $ IdentityError "Error occurred while trying to create vault key for user"

server ::
  ( MonadIO m,
    MonadLogger m,
    HasVault m,
    Accessible Issuer m,
    Accessible X509Certificate m,
    Accessible PrivateKey m,
    Accessible RealmData m,
    Accessible (Maybe SendgridAPIKey) m
  ) =>
  ServerT IDAPI.IdentityProviderAPI m
server = getPingIdentity :<|> putIdentity :<|> putIdentityExternal

hoistCoreServer ::
  String ->
  Issuer ->
  X509Certificate ->
  PrivateKey ->
  RealmData ->
  Maybe SendgridAPIKey ->
  Server IDAPI.IdentityProviderAPI
hoistCoreServer vaulturl iss cert privk rd mEmailK = hoistServer (Proxy :: Proxy IDAPI.IdentityProviderAPI) (convertErrors runM') server
  where
    convertErrors r x = Handler $ do
      eRes <- liftIO . try $ r x
      case eRes of
        Right a -> return a
        Left e -> throwE $ reThrowError e
    runM' :: ReaderT IdentityServerData (VaultM (LoggingT IO)) x -> IO x
    runM' x = runLoggingT . runVaultM vaulturl $ runIdentityM iss cert privk rd mEmailK x
    reThrowError :: IdentityError -> ServerError
    reThrowError =
      \case
        IdentityError err -> err400 {errBody = BL.fromStrict $ encodeUtf8 err}

runIdentityM ::
  Issuer ->
  X509Certificate ->
  PrivateKey ->
  RealmData ->
  Maybe SendgridAPIKey ->
  ReaderT IdentityServerData m a ->
  m a
runIdentityM iss cert privk rd mEmailK x = runReaderT x $ IdentityServerData iss cert privk rd mEmailK

identityProviderApp ::
  String ->
  Issuer ->
  X509Certificate ->
  PrivateKey ->
  RealmData ->
  Maybe SendgridAPIKey ->
  Application
identityProviderApp vurl iss cert pk rd mEmailK = serve (Proxy :: Proxy IDAPI.IdentityProviderAPI) $ hoistCoreServer vurl iss cert pk rd mEmailK
