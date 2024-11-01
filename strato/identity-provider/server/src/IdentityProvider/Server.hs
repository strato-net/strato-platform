{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
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

module IdentityProvider.Server (identityProviderApp) where

import Bloc.API.Transaction
import Bloc.API.Users
import Bloc.Client (postBlocTransactionParallel, postBlocTransactionResults)
import BlockApps.Logging
import BlockApps.Solidity.ArgValue
import BlockApps.X509 hiding (isValid)
import Blockchain.Strato.Model.Address (deriveAddressWithSalt)
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import Blockchain.Strato.Model.Secp256k1 hiding (HasVault)
import Control.Monad (void, when)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Change.Modify
import Control.Monad.Composable.Vault
import Control.Monad.Composable.Notification
import Control.Monad.Reader
import Control.Monad.Trans.Except
import Data.Aeson hiding (Success)
import qualified Data.ByteString.Lazy as BL
import Data.List (elemIndex)
import qualified Data.Map as M
import Data.Maybe (fromMaybe)
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, encodeUtf8)
import Data.Time (getCurrentTime)
import GHC.Generics
import qualified IdentityProvider.API as IDAPI
import IdentityProvider.Email
import IdentityProvider.OAuth hiding (issuer)
import IdentityProvider.Server.Types
import Network.HTTP.Client hiding (Proxy)
import qualified Network.HTTP.Client as HTTP (Response)
import Network.HTTP.Client.TLS
import Network.HTTP.Types.Header (hAuthorization, hContentType)
import Network.HTTP.Types.Status
import Servant
import Servant.Client hiding (manager, responseBody)
import SolidVM.Model.Value (ValList (..), Value (..))
import Strato.Strato23.API
import Strato.Strato23.Client
import UnliftIO hiding (Handler)

getDefaultEmptyOrg :: String -> String -> String
getDefaultEmptyOrg name uuid = "Mercata Account " ++ getDefaultEmptyOrgOld name uuid

getDefaultEmptyOrgOld :: String -> String -> String
getDefaultEmptyOrgOld name uuid = case elemIndex ' ' name of
  Nothing -> head name : take 8 uuid
  Just idx ->
    let lastNs = drop (idx + 1) name
     in head name : lastNs ++ take 8 uuid

getSubject ::
  ( MonadIO m,
    MonadLogger m
  ) =>
  String ->
  String ->
  PublicKey ->
  m Subject
getSubject "" _ _ = do
  $logErrorS "getSubject" "Improper query params! Param 'name' is not defined or is empty. Cannot create a cert with so little info"
  throwIO $ IdentityError "Param 'name' cannot be empty"
getSubject name org pk =
  pure
    Subject
      { subCommonName = name,
        subOrg = org,
        subUnit = Nothing,
        subCountry = Nothing,
        subPub = pk
      }

instance Monad m => Accessible VaultData (VaultM m) where
  access _ = ask

instance (Monad m, Accessible VaultData m) => Accessible VaultData (ReaderT IdentityServerData m) where
  access = lift . access

instance Monad m => Accessible NotificationData (NotificationM m) where
  access _ = ask

getPingIdentity :: (MonadIO m) => m Int
getPingIdentity = return 1

putIdentity ::
  ( MonadUnliftIO m,
    MonadLogger m,
    HasVault m,
    Accessible Issuer m,
    Accessible X509Certificate m,
    Accessible PrivateKey m,
    Accessible IdentityServerData m,
    Accessible (Maybe SendgridAPIKey) m,
    Accessible (Maybe AccessToken) m,
    (String `A.Alters` Address) m
  ) =>
  Text ->
  Text ->
  Text ->
  Maybe Text ->
  Maybe Text ->
  Maybe Bool ->
  m Address
putIdentity accessToken uuid name mEmail mCo mSub = do
  time' <- liftIO getCurrentTime
  $logInfoS "putIdentity" $ "User " <> uuid <> " called PUT /identity with username " <> name <> " and company " <> T.pack (show mCo)
  -- check if a user exists in vault
  let name' = T.unpack name
      uuid' = T.unpack uuid
      org = case mCo of
        Just o | o /= "" -> T.unpack o
        _ -> getDefaultEmptyOrg name' uuid'
      csvLogMsg =
        T.intercalate
          ","
          [ T.pack $ show time',
            uuid,
            name,
            T.pack org
          ]
  $logInfoS "putIdentity/csv" csvLogMsg

  -- check if cached user
  A.lookup Proxy uuid' >>= \case
    Just a -> return a
    Nothing -> do
      IdentityServerData{notificationServerUrl = mNotifUrl} <- access Proxy
      mToken <- access (Proxy @(Maybe AccessToken))
      case mToken of
        Just realmToken -> do
          getVaultKey accessToken >>= \case
            Just (AddressAndKey a k) -> do
              -- has vault key, confirm also has cert
              certInCirrus accessToken a name' >>= \case
                -- User has no cert, create cert and wallet.
                [] -> do
                  createAndRegisterCert name' (T.unpack <$> mEmail) org uuid' realmToken k
                  registerUserWalletAsync realmToken name' uuid' a
                  -- subscribe if can and should
                  case (mNotifUrl, fromMaybe True mSub) of 
                    (Just url, True) -> void . async $ runNotificationM url $ subscribeUser accessToken (T.pack name')
                    (_, _) -> return ()
                -- User has a cert but no wallet, create wallet using cert's common name. This is for backwards compatibility with existing users.
                [cert] -> do
                  hasWallet <- walletInCirrus accessToken (T.unpack $ certCommonName cert)
                  if hasWallet
                    then A.insert Proxy uuid' a
                    else do
                      registerUserWalletAsync realmToken (T.unpack $ certCommonName cert) uuid' a
                -- Query returned multiple certs even though cirrus query should return only the latest one, fix the logic please.
                _ -> do
                  $logErrorS "putIdentity" "Yikes! How can we have multiple certs if we're only limiting the search to one?"
                  throwIO $ IdentityError "Something is wrong. Have a network administrator look into this."
              return a
            Nothing -> do
              -- no vault key, so make key and register cert
              AddressAndKey a k <- postVaultKey accessToken
              createAndRegisterCert name' (T.unpack <$> mEmail) org uuid' realmToken k
              registerUserWalletAsync realmToken name' uuid' a
              -- subscribe if can and should
              _ <- case (mNotifUrl, fromMaybe True mSub) of 
                (Just url, True) -> void . async $ runNotificationM url $ subscribeUser accessToken (T.pack name')
                (_, _) -> return ()
              return a
        Nothing -> do
          $logErrorS "putIdentity" "uh oh! We couldn't retrieve an access token for our realm"
          throwIO $ IdentityError "Something is wrong with the provided access credentials for the current realm. Have a network administrator look into this."

-- This is just a dummy function
-- This never gets called on the sevrvant backend
-- This is created for the client binding
-- which is used within the strato node to form a request
-- which Identity server's nginx transforms the headers
-- which patterns matches with putIdentity
putIdentityExternal ::
  ( MonadUnliftIO m,
    MonadLogger m,
    HasVault m,
    Accessible Issuer m,
    Accessible X509Certificate m,
    Accessible PrivateKey m,
    Accessible IdentityServerData m,
    Accessible (Maybe SendgridAPIKey) m,
    Accessible (Maybe AccessToken) m,
    (String `A.Alters` Address) m
  ) =>
  Text ->
  Maybe Bool ->
  m Address
putIdentityExternal bearerToken = putIdentity (T.replace "Bearer " "" bearerToken) "" "" Nothing Nothing

blocEndpoint :: String
blocEndpoint = "/bloc/v2.2"

data CertificateInCirrus = CertificateInCirrus
  { certCommonName :: Text,
    -- organization :: Text,
    isValid :: Bool
  }
  deriving (Show, Generic)

instance FromJSON CertificateInCirrus where
  parseJSON = withObject "CertificateInCirrus" $ \v -> do
    commonName <- v .: "commonName"
    isValid <- v .: "isValid"
    return CertificateInCirrus {certCommonName = commonName, isValid = isValid}

instance ToJSON CertificateInCirrus

data WalletInCirrus = WalletInCirrus
  { walletCommonName :: Text
  }
  deriving (Show, Generic)

instance FromJSON WalletInCirrus where
  parseJSON = withObject "WalletInCirrus" $ \v -> do
    commonName <- v .: "commonName"
    return WalletInCirrus {walletCommonName = commonName}

instance ToJSON WalletInCirrus

certInCirrus ::
  (MonadIO m
  , MonadLogger m
  , Accessible IdentityServerData m) =>
  Text ->
  Address ->
  String ->
  m [CertificateInCirrus]
certInCirrus token a name = do
  IdentityServerData{nodeUrl = nurl1, fallbackNodeUrl = mNurl2} <- access (Proxy @IdentityServerData)
  response1 <- callCirrus nurl1
  mCerts :: Maybe [CertificateInCirrus] <- 
    case (statusCode (responseStatus response1), mNurl2) of 
      (200, _) -> return . decode $ responseBody response1
      (_, Just nurl2) -> callCirrus nurl2 >>= return . decode . responseBody
      (_, Nothing) -> return Nothing
  case mCerts of
    Just certs -> do
      $logInfoS "certInCirrus" $ T.pack $ "Checked for user's cert in Cirrus; response was: " <> show certs
      return certs -- maybe can also check if cert is valid and matches user attributes
    Nothing -> do
      $logErrorS "certInCirrus" "Unexpected response from cirrus query. This should never happen"
      throwIO $ IdentityError "Unable to decode cirrus query for user's cert. Something went very wrong"
  where
    cirrusSearchPath :: Address -> String -> String
    cirrusSearchPath address commonName =
      "/cirrus/search/Certificate?or=(userAddress.eq." <> show address <> ",commonName.eq." <> commonName <> ")&order=block_timestamp.desc&limit=1"

    callCirrus :: MonadIO m => BaseUrl -> m (HTTP.Response BL.ByteString)
    callCirrus nurl = do
      let cirrusEndpoint = cirrusSearchPath a name
          url = showBaseUrl nurl {baseUrlPath = baseUrlPath nurl <> cirrusEndpoint}
      mgr <- liftIO $ case baseUrlScheme nurl of
        Http -> newManager defaultManagerSettings
        Https -> newManager tlsManagerSettings
      request <- liftIO $ parseRequest url
      let rHead = [(hContentType, "application/json"), (hAuthorization, encodeUtf8 $ "Bearer " <> token)]
      liftIO $ httpLbs request {requestHeaders = rHead} mgr

walletInCirrus ::
  ( MonadIO m
  , MonadLogger m
  , Accessible IdentityServerData m) =>
  Text ->
  String ->
  m Bool
walletInCirrus token commonName = do
  IdentityServerData
    { nodeUrl = nurl1,
      fallbackNodeUrl = mNurl2,
      userTableName = utn,
      userRegAddr = ura,
      userRegCodeHash = urch
    } <- access Proxy
  response1 <- callCirrus ura urch utn nurl1
  mWallet :: Maybe [WalletInCirrus] <-
    case (statusCode (responseStatus response1), mNurl2) of
      (200, _) -> return . decode $ responseBody response1
      (_, Just nurl2) -> callCirrus ura urch utn nurl2 >>= return . decode . responseBody
      (_, Nothing) -> return Nothing
  case mWallet of
    Just wallet -> do
      $logInfoS "walletInCirrus" $ T.pack $ "Checked for user's wallet in Cirrus; response was: " <> show wallet
      return . not $ null wallet -- maybe can also check if cert is valid and matches user attributes
    Nothing -> do
      $logErrorS "walletInCirrus" "Unexpected response from cirrus query. This should never happen"
      throwIO $ IdentityError "Unable to decode cirrus query for user's wallet. Something went very wrong"
  where
    cirrusSearchPath :: (MonadLogger m) => Address -> Maybe Keccak256 -> String -> m String
    cirrusSearchPath ura urch utn = do
      let derivedAddr = deriveAddressWithSalt (Just ura) commonName urch (Just . show $ OrderedVals [SString $ commonName])
          derivedAddr' = show derivedAddr
          path = "/cirrus/search/" <> utn <> "?address=eq." <> derivedAddr' 
      $logDebugS "walletInCirrus/cirrusSearchPath" $ "Derived address is " <> T.pack derivedAddr'
      $logDebugS "walletInCirrus/cirrusSearchPath" $ "Cirrus search path is " <> T.pack path
      return path

    callCirrus :: (MonadIO m, MonadLogger m) => Address -> Maybe Keccak256 -> String -> BaseUrl -> m (HTTP.Response BL.ByteString)
    callCirrus ura mH utn nurl = do
      cirrusEndpoint <- cirrusSearchPath ura mH utn
      let url = showBaseUrl nurl {baseUrlPath = baseUrlPath nurl <> cirrusEndpoint}
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
    Accessible (Maybe SendgridAPIKey) m,
    Accessible IdentityServerData m
  ) =>
  String ->
  Maybe String ->
  String ->
  String ->
  AccessToken ->
  PublicKey ->
  m ()
createAndRegisterCert name mEmail org uuid realmToken k = do
  sub <- getSubject name org k
  createNewCert sub >>= \case
    Just newCert -> do
      registerCert newCert realmToken
      mEmailK <- access (Proxy @(Maybe SendgridAPIKey))
      case (mEmail, mEmailK) of
        (Just email, Just emailK) -> sendWelcomeEmail email name uuid emailK
        (_, _) -> return ()
    Nothing -> do
      $logErrorS "createAndRegisterCert" . T.pack $ "Error occurred while trying to sign a cert for user " ++ uuid
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
  ( MonadIO m
  , MonadLogger m
  , Accessible IdentityServerData m) =>
  X509Certificate ->
  AccessToken ->
  m ()
registerCert cert token = do
  IdentityServerData {nodeUrl = nurl, fallbackNodeUrl = mNurl2} <- access Proxy
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
      postBlocTx = runClientM (postBlocTransactionParallel (Just $ "Bearer " <> access_token token) Nothing Nothing True False txRequest)
  eresponse <- liftIO $ postBlocTx clientEnv
  case eresponse of
    Right response ->
      if all txSuccess response
        then $logInfoS "registerCert" $ T.pack $ "Response after registering cert was: " ++ show response
        else do -- got a pending or failure
          let pending = [hash | BlocTxResult (BlocTransactionResult {blocTransactionStatus = Pending, blocTransactionHash = hash}) <- response]
          if (not $ null pending) 
            then do 
              eresponse2 <- liftIO $ runClientM (postBlocTransactionResults (Just $ "Bearer " <> access_token token) True pending) clientEnv
              case eresponse2 of 
                Right response2 | all (\r -> blocTransactionStatus r == Success) response2 -> $logInfoS "registerCert" $ T.pack $ "Response after registering cert was: " ++ show response2
                err -> do 
                  $logErrorS "registerCert" $ T.pack $ "Failed to register cert for user; response was: " ++ show err
                  throwIO $ IdentityError "Failed to register cert"
            else do -- must've all been failures
              $logErrorS "registerCert" $ T.pack $ "Failed to register cert for user; response was: " ++ show response
              throwIO $ IdentityError "Failed to register cert"
    Left clienterr -> do
      $logErrorS "registerCert" $
        T.pack $
          "Recieved the following error when registering cert on primary node: "
            ++ show clienterr
      case mNurl2 of
        Nothing -> throwIO $ IdentityError "Failed to register cert"
        Just nurl2 -> do
          $logInfoS "registerCert" "Attempting ot register cert on fallback node"
          mgr2 <- liftIO $ case baseUrlScheme nurl2 of
            Http -> newManager defaultManagerSettings
            Https -> newManager tlsManagerSettings
          let clientEnv2 = mkClientEnv mgr2 nurl2 {baseUrlPath = baseUrlPath nurl2 <> blocEndpoint}
          eresponse2 <- liftIO $ postBlocTx clientEnv2
          case eresponse2 of
            Right response2 | all txSuccess response2 -> $logInfoS "registerCert" $ T.pack $ "Response from fallback node was " ++ show response2
            err -> do
              $logErrorS "registerCert" $
                T.pack $
                  "Received following error when trying to register cert on fallback node: " ++ show err
              throwIO $ IdentityError "Failed to register cert"

txSuccess :: BlocChainOrTransactionResult -> Bool
-- txSuccess (BlocTxResult (BlocTransactionResult{blocTransactionStatus = stat})) | stat /= Failure = True
txSuccess (BlocTxResult BlocTransactionResult {blocTransactionStatus = Success}) = True
txSuccess _ = False

registerUserWalletAsync ::
  ( MonadUnliftIO m,
    MonadLogger m,
    (String `A.Alters` Address) m,
    Accessible IdentityServerData m
  ) =>
  AccessToken ->
  String ->
  String ->
  Address ->
  m ()
registerUserWalletAsync realmToken name' uuid' a = void . async $ do
  regSuccess <- registerUserWallet realmToken name'
  when regSuccess $ A.insert Proxy uuid' a

registerUserWallet ::
  (MonadUnliftIO m
  , MonadLogger m
  , Accessible IdentityServerData m) =>
  AccessToken ->
  String ->
  m Bool
registerUserWallet token commonName = do
  IdentityServerData
    { nodeUrl = nurl,
      fallbackNodeUrl = mNurl2,
      userRegAddr = userRegAddr
    } <- access Proxy
  mgr <- liftIO $ case baseUrlScheme nurl of
    Http -> newManager defaultManagerSettings
    Https -> newManager tlsManagerSettings
  let clientEnv = mkClientEnv mgr nurl {baseUrlPath = baseUrlPath nurl <> blocEndpoint}
      txPayload =
        BlocFunction
          FunctionPayload
            { functionpayloadContractAddress = userRegAddr,
              functionpayloadMethod = "createUser",
              functionpayloadArgs = M.singleton "_commonName" (ArgString $ T.pack commonName),
              functionpayloadValue = Nothing,
              functionpayloadTxParams = Nothing,
              functionpayloadChainid = Nothing,
              functionpayloadMetadata = Nothing
            }
      txRequest = PostBlocTransactionRequest Nothing [txPayload] Nothing Nothing
      postBlocTx = runClientM (postBlocTransactionParallel (Just $ "Bearer " <> access_token token) Nothing Nothing True False txRequest)
  eresponse <- liftIO $ postBlocTx clientEnv
  case eresponse of
    Right response ->
      if all txSuccess response
        then do
          $logInfoS "registerUserWallet"
            . T.pack
            $ "Response after registering user wallet was: " ++ show response
          return True
        else do -- got a pending or failure
          let pending = [hash | BlocTxResult (BlocTransactionResult {blocTransactionStatus = Pending, blocTransactionHash = hash}) <- response]
          if (not $ null pending) 
            then do 
              eresponse2 <- liftIO $ runClientM (postBlocTransactionResults (Just $ "Bearer " <> access_token token) True pending) clientEnv
              case eresponse2 of
                Right response2 | all (\r -> blocTransactionStatus r == Success) response2 -> do
                  $logInfoS "registerUserWallet" $ T.pack $ "Response after registering user wallet was: " ++ show response2
                  return True
                err -> do 
                  $logErrorS "registerUserWallet" $ T.pack $ "Failed to register user wallet; response was: " ++ show err
                  return False
            else do -- must've all been failures
              $logErrorS "registerUserWallet" $ T.pack $ "Failed to register user wallet; response was: " ++ show response
              return False
    Left clienterr -> do
      $logErrorS "registerUserWallet" $
        T.pack $
          "Recieved the following error when registering user wallet on primary node: "
            ++ show clienterr
      case mNurl2 of
        Nothing -> return False
        Just nurl2 -> do
          $logInfoS "registerUserWallet" "Attempting to register user wallet on fallback node"
          mgr2 <- liftIO $ case baseUrlScheme nurl2 of
            Http -> newManager defaultManagerSettings
            Https -> newManager tlsManagerSettings
          let clientEnv2 = mkClientEnv mgr2 nurl2 {baseUrlPath = baseUrlPath nurl2 <> blocEndpoint}
          eresponse2 <- liftIO $ postBlocTx clientEnv2
          case eresponse2 of
            Right response2 | all txSuccess response2 -> do
              $logInfoS "registerUserWallet" . T.pack $ "Response from fallback node was " ++ show response2
              return True
            err -> do
              $logErrorS "registerUserWallet"
                . T.pack
                $ "Failed to register user wallet; response was: " ++ show err
              return False

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
  ( MonadUnliftIO m,
    MonadLogger m,
    HasVault m,
    Accessible Issuer m,
    Accessible X509Certificate m,
    Accessible PrivateKey m,
    Accessible IdentityServerData m,
    Accessible (Maybe SendgridAPIKey) m,
    Accessible (Maybe AccessToken) m,
    (String `A.Alters` Address) m
  ) =>
  ServerT IDAPI.IdentityProviderAPI m
server = getPingIdentity :<|> putIdentity :<|> putIdentityExternal

hoistCoreServer ::
  String ->
  IdentityServerData ->
  Server IDAPI.IdentityProviderAPI
hoistCoreServer vaulturl idData =
  hoistServer (Proxy :: Proxy IDAPI.IdentityProviderAPI) (convertErrors runM') server
  where
    convertErrors r x = Handler $ do
      eRes <- liftIO . try $ r x
      case eRes of
        Right a -> return a
        Left e -> throwE $ reThrowError e
    runM' :: ReaderT IdentityServerData (VaultM (LoggingT IO)) x -> IO x
    runM' x = runLoggingT . runVaultM vaulturl $ runIdentityM idData x
    reThrowError :: IdentityError -> ServerError
    reThrowError =
      \case
        IdentityError err -> err400 {errBody = BL.fromStrict $ encodeUtf8 err}
        ExistingIdentity err -> err422 {errBody = BL.fromStrict $ encodeUtf8 err}

runIdentityM ::
  IdentityServerData ->
  ReaderT IdentityServerData m a ->
  m a
runIdentityM idData x =
  runReaderT x idData

identityProviderApp ::
  String ->
  IdentityServerData ->
  Application
identityProviderApp vurl idData =
  serve (Proxy :: Proxy IDAPI.IdentityProviderAPI) $ hoistCoreServer vurl idData
