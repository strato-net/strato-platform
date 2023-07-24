{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE DeriveAnyClass        #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE DeriveGeneric         #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE DeriveFunctor         #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE PolyKinds             #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeFamilies          #-}
{-# LANGUAGE UndecidableInstances  #-}
{-# LANGUAGE StandaloneDeriving    #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE RecordWildCards       #-}
{-# OPTIONS_GHC -fno-warn-orphans  #-}

module IdentityProvider.Server
    ( identityProviderApp )
where

import           UnliftIO                                hiding (Handler)
import           Servant                                 
import           Servant.Client                          hiding (responseBody, manager)
import           Network.HTTP.Client                     hiding (Proxy)
import           Network.HTTP.Client.TLS
import           Network.HTTP.Types.Header               (hContentType, hAuthorization)
import           Network.HTTP.Types.Status

import           Data.Aeson
import           Data.ByteString.Base64
import qualified Data.ByteString.Lazy                    as BL
import qualified Data.ByteString.UTF8 as B               (fromString)
import           Data.List                               (isSuffixOf)
import qualified Data.Map as M
import qualified Data.Text as T                          
import           Data.Text.Encoding                      (encodeUtf8, decodeUtf8)
import           GHC.Generics

import           Bloc.API.Transaction
import           Bloc.Client
import           BlockApps.Solidity.ArgValue
import           BlockApps.X509                          hiding (isValid)
import           Blockchain.Strato.Model.Secp256k1       hiding (HasVault)
import qualified IdentityProvider.API                    as IDAPI
import           Strato.Strato23.API
import           Strato.Strato23.Client
-- import           SQLM

import           Control.Monad.Change.Modify
import           Control.Monad.Composable.Vault
import           Control.Monad.Reader
import           Control.Monad.Trans.Except
import           BlockApps.Logging

data IdentityError
  = IdentityError T.Text
  deriving (Show, Exception)

newtype AccessToken = AccessToken {access_token :: T.Text} deriving (Show, Generic)
instance FromJSON AccessToken
instance ToJSON AccessToken

getAccessToken :: MonadIO m => String -> String -> String -> m (Maybe AccessToken)
getAccessToken id' sec realm = do
    manager <- liftIO $ newManager tlsManagerSettings
    let creds64 = encodeBase64' . B.fromString $ id' <> ":" <> sec
    templateRequest <- liftIO . parseRequest $ "POST https://keycloak.blockapps.net/auth/realms/" <> realm <> "/protocol/openid-connect/token"
    let rBody = RequestBodyLBS "grant_type=client_credentials"
        rHead = [(hContentType, "application/x-www-form-urlencoded"), (hAuthorization, "Basic " <> creds64)]
        request = templateRequest{requestHeaders = rHead, requestBody = rBody}
    response <- liftIO $ httpLbs request manager
    return $ decode $ responseBody response

getMasterAccessToken :: ( MonadIO m
                        , Accessible MasterClientId m
                        , Accessible MasterClientSecret m
                        ) => m (Maybe AccessToken)
getMasterAccessToken = do
    MasterClientId mcid <- access Proxy
    MasterClientSecret msec <- access Proxy
    getAccessToken mcid msec "master"

getRealmAccessToken :: ( MonadIO m 
                       , Accessible ClientId m 
                       , Accessible ClientSecret m
                       ) => T.Text -> m (Maybe AccessToken)
getRealmAccessToken realm = do 
    ClientId cid <- access Proxy 
    ClientSecret csec <- access Proxy
    getAccessToken cid csec (T.unpack realm)

newtype OAuthUserAttributes = OAuthUserAttributes {companyName :: Maybe [T.Text]} deriving (Show, Generic)
instance FromJSON OAuthUserAttributes
instance ToJSON OAuthUserAttributes
data OAuthUser = OAuthUser {
    id          :: T.Text, --untested
    firstName   :: T.Text,
    lastName    :: T.Text,
    attributes  :: Maybe OAuthUserAttributes
} deriving (Show, Generic)
instance FromJSON OAuthUser
instance ToJSON OAuthUser

oAuthUserToSubject :: OAuthUser -> PublicKey -> Subject
oAuthUserToSubject (OAuthUser id' firstN' lastN' attr) pk = 
    let firstN = T.unpack firstN'
        lastN = T.unpack lastN'
    in Subject {
    subCommonName =  firstN <> " " <> lastN,
    subOrg = case attr of
        Just (OAuthUserAttributes (Just (org:_))) | not (T.null org) -> T.unpack org
        _ -> head firstN : lastN ++ T.unpack (T.take 8 id')
    ,
    subUnit = Nothing,
    subCountry = Nothing,
    subPub = pk
}

getUserByUUID :: ( MonadIO m
                 , MonadLogger m
                 ) => AccessToken -> T.Text -> T.Text -> m (Either String OAuthUser)
getUserByUUID token uuid realm = do
    manager <- liftIO $ newManager tlsManagerSettings
    let url = "https://keycloak.blockapps.net/auth/admin/realms/" <> realm <> "/users/" <> uuid
    $logInfoS "getUserByUUID" $ "url is " <> url
    templateRequest <- liftIO $ parseRequest $ T.unpack url
    let rHead = [(hContentType, "application/json"), (hAuthorization, encodeUtf8 $ "Bearer " <> access_token token)]
        request = templateRequest{requestHeaders=rHead}
    response <- liftIO $ httpLbs request manager
    $logInfoS "getUserByUUIDResponse" $ T.pack $ show response
    return $ eitherDecode $ responseBody response

newtype ClientId = ClientId String 
newtype ClientSecret = ClientSecret String
newtype MasterClientId = MasterClientId String 
newtype MasterClientSecret = MasterClientSecret String
data IdentityServerData = IdentityServerData 
    { issuer             :: Issuer          -- issuer of signing cert
    , issuerCert         :: X509Certificate -- the signing cert
    , issuerPrivKey      :: PrivateKey      -- the signing private key
    , blocAPIUrl         :: BaseUrl -- strato node where will register cert
    , clientId           :: ClientId
    , clientSecret       :: ClientSecret
    , masterClientId     :: MasterClientId
    , masterClientSecret :: MasterClientSecret
}
instance Monad m => Accessible Issuer (ReaderT IdentityServerData m) where 
    access _ = asks issuer
instance Monad m => Accessible X509Certificate (ReaderT IdentityServerData m) where 
    access _ = asks issuerCert
instance Monad m => Accessible PrivateKey (ReaderT IdentityServerData m) where 
    access _ = asks issuerPrivKey
instance Monad m => Accessible BaseUrl (ReaderT IdentityServerData m) where 
    access _ = asks blocAPIUrl
instance Monad m => Accessible ClientId (ReaderT IdentityServerData m) where 
    access _ = asks clientId
instance Monad m => Accessible ClientSecret (ReaderT IdentityServerData m) where 
    access _ = asks clientSecret
instance Monad m => Accessible MasterClientId (ReaderT IdentityServerData m) where 
    access _ = asks masterClientId
instance Monad m => Accessible MasterClientSecret (ReaderT IdentityServerData m) where 
    access _ = asks masterClientSecret
instance Monad m => Accessible VaultData (VaultM m) where
  access _ = ask
instance (Monad m, Accessible VaultData m) => Accessible VaultData (ReaderT IdentityServerData m) where 
    access = lift . access


getPingIdentity :: (MonadIO m) => m Int
getPingIdentity = return 1

putIdentity :: ( MonadIO m
               , MonadLogger m
               , HasVault m
               , Accessible Issuer m
               , Accessible X509Certificate m
               , Accessible PrivateKey m
               , Accessible BaseUrl m 
               , Accessible ClientId m
               , Accessible ClientSecret m
               , Accessible MasterClientId m
               , Accessible MasterClientSecret m
               ) => T.Text -> T.Text -> T.Text -> m Address
putIdentity accessToken uuid idProv = do
    $logInfoS "putIdentity" $ "User " <> uuid <> " called PUT /identity"
    -- check if a user exists in vault
    let realm = last $ T.splitOn "/" (if "/" `T.isSuffixOf` idProv then T.init idProv else idProv)
    getVaultKey accessToken >>= \case
        Just (AddressAndKey a k) -> do -- has vault key, confirm also has cert
            hasCert <- certInCirrus accessToken a
            unless hasCert $ createAndRegisterCert uuid realm k
            return a
        Nothing -> do -- no vault key, so make key and register cert
            AddressAndKey a k <- postVaultKey accessToken
            createAndRegisterCert uuid realm k
            return a

-- This is just a dummy function
-- This never gets called on the sevrvant backend
-- This is created for the client binding
-- which is used within the strato node to form a request
-- which Identity server's nginx transforms the headers
-- which patterns matches with putIdentity
putIdentityExternal :: ( MonadIO m
               , MonadLogger m
               , HasVault m
               , Accessible Issuer m
               , Accessible X509Certificate m
               , Accessible PrivateKey m
               , Accessible BaseUrl m 
               , Accessible ClientId m
               , Accessible ClientSecret m
               , Accessible MasterClientId m
               , Accessible MasterClientSecret m
               ) => T.Text -> m Address
putIdentityExternal bearerToken = putIdentity  (T.replace "Bearer " "" bearerToken) "" ""


blocEndpoint :: String
blocEndpoint = "bloc/v2.2"

data CertificateInCirrus = CertificateInCirrus{
    -- commonName :: Text,
    -- organization :: Text,
    isValid :: Bool
} deriving (Show, Generic)
instance FromJSON CertificateInCirrus
instance ToJSON CertificateInCirrus

certInCirrus :: (MonadIO m, MonadLogger m, Accessible BaseUrl m) => T.Text -> Address -> m Bool 
certInCirrus token a = do 
    url <- access (Proxy @BaseUrl)
    let cirrusUrl = "cirrus/search/Certificate?userAddress=eq." <> show a
        url' = T.unpack $ T.replace (T.pack blocEndpoint) (T.pack cirrusUrl) (T.pack $ showBaseUrl url)
    mgr <- liftIO $ case baseUrlScheme url of
        Http -> newManager defaultManagerSettings
        Https -> newManager tlsManagerSettings
    templateRequest <- liftIO $ parseRequest url'
    let rHead = [(hContentType, "application/json"), (hAuthorization, encodeUtf8 $ "Bearer " <> token)]
        request = templateRequest{requestHeaders = rHead}
    response <- liftIO $ httpLbs request mgr
    let mCerts:: Maybe [CertificateInCirrus] = decode $ responseBody response
    case mCerts of 
        Just certs -> do
            $logInfoS "certInCirrus" $ T.pack $ "Cirrus response was: " <> show certs
            return . not $ null certs -- maybe can also check if cert is valid and matches user attributes
        Nothing -> error "Unexpected response from cirrus query. This should never happen"

createAndRegisterCert :: ( MonadIO m
                         , MonadLogger m
                         , Accessible Issuer m
                         , Accessible X509Certificate m
                         , Accessible PrivateKey m
                         , Accessible ClientId m 
                         , Accessible ClientSecret m 
                         , Accessible MasterClientId m 
                         , Accessible MasterClientSecret m 
                         , Accessible BaseUrl m
                         ) => T.Text -> T.Text -> PublicKey -> m ()
createAndRegisterCert uuid realm k = do 
    getMasterAccessToken >>= \case 
        Nothing -> do 
            $logErrorS "createAndRegisterCert" "uh oh! We couldn't get an access token for the master realm"
            throwIO $ IdentityError "Something is wrong with the provided access credentials for the master realm. Have a network administrator look into this."
        Just masterToken -> do
            getUserByUUID masterToken uuid realm >>= \case
                Left err -> do 
                    $logErrorS "createAndRegisterCert" $ "Error occurred while querying OAuth server for information on user with uuid " <> uuid <> ": " <> T.pack err
                    throwIO $ IdentityError "Could not retrieve user's information from OAuth server"
                Right user -> do             
                    createNewCert user k >>= \case 
                        Just newCert -> do
                            getRealmAccessToken realm >>= \case 
                                Nothing -> do
                                    $logErrorS "createAndRegisterCert" "uh oh! We couldn't an access token for our realm"
                                    throwIO $ IdentityError "Something is wrong with the provided access credentials for the current realm. Have a network administrator look into this."
                                Just realmToken -> registerCert newCert realmToken
                        Nothing -> do 
                            $logErrorS "createAndRegisterCert" $ "Error occurred while trying to sign a cert for user " <> uuid
                            throwIO $ IdentityError "Unable to sign new cert for user"

createNewCert :: ( MonadIO m
                 , Accessible Issuer m
                 , Accessible X509Certificate m
                 , Accessible PrivateKey m
                 ) => OAuthUser -> PublicKey -> m (Maybe X509Certificate)
createNewCert user k = do 
    i <- access (Proxy @Issuer) 
    c <- access (Proxy @X509Certificate)
    iK <- access (Proxy @PrivateKey)
    let signWIssuerPrivKey bs = return $ signMsg iK bs
    makeSignedCertSigF signWIssuerPrivKey Nothing (Just c) i (oAuthUserToSubject user k)

registerCert :: (MonadIO m, MonadLogger m, Accessible BaseUrl m) => X509Certificate -> AccessToken -> m ()
registerCert cert token = do 
    url <- access (Proxy @BaseUrl)
    mgr <- liftIO $ case baseUrlScheme url of
        Http -> newManager defaultManagerSettings
        Https -> newManager tlsManagerSettings
    let clientEnv = mkClientEnv mgr url
        txPayload = BlocFunction FunctionPayload{
            functionpayloadContractAddress = 0x509,
            functionpayloadMethod = "registerCertificate",
            functionpayloadArgs = M.singleton "newCertificateString" (ArgString . decodeUtf8 $ certToBytes cert),
            functionpayloadValue = Nothing,
            functionpayloadTxParams = Nothing,
            functionpayloadChainid = Nothing,
            functionpayloadMetadata = Nothing
        }
        txRequest = PostBlocTransactionRequest Nothing [txPayload] Nothing Nothing
    eresponse <- liftIO $ runClientM (postBlocTransactionExternal (Just $ "Bearer " <> access_token token) Nothing True txRequest) clientEnv
    $logInfoS "registerCert" $ T.pack $ "Response after registering cert was: " ++ show eresponse 
    --TODO: how to tell if cert successfully added to blockchain?

getVaultKey :: (MonadIO m, MonadLogger m, HasVault m) => T.Text -> m (Maybe AddressAndKey)
getVaultKey accessToken = do 
    VaultData url mgr <- access Proxy   
    eAddressNKey <- liftIO $ runClientM (getKey (Just accessToken) Nothing) (mkClientEnv mgr url)
    $logInfoS "getVaultKey" $ T.pack $ "response is " <> show eAddressNKey
    case eAddressNKey of 
        Right a -> return $ Just a
        -- only errors from GET /key are user doesn't exist (400) or incorrect pw (503)
        -- beware if the error behavior for /key changes
        Left (FailureResponse _ Response{..}) | responseStatusCode == status400 -> return Nothing
        Left err -> do 
            $logInfoS "getVaultKey" $ T.pack $ "User key not found in vault: " <> show err
            throwIO $ IdentityError "User key not found in vault"

postVaultKey :: (MonadIO m, MonadLogger m, HasVault m) => T.Text -> m AddressAndKey
postVaultKey accessToken = do
    VaultData url mgr <- access Proxy
    eAddressNKey <- liftIO $ runClientM (postKey (Just accessToken)) (mkClientEnv mgr url)
    $logInfoS "postVaultKey" $ T.pack $ "response is " <> show eAddressNKey
    case eAddressNKey of 
        Right a -> return a
        Left err -> do 
            $logErrorS "postVaultKey" $ T.pack $ "error posting user's pubkey: " <> show err
            throwIO $ IdentityError "Error occurred while trying to create vault key for user"

server :: ( MonadIO m
          , MonadLogger m
          , HasVault m
          , Accessible Issuer m
          , Accessible X509Certificate m
          , Accessible PrivateKey m
          , Accessible BaseUrl m
          , Accessible ClientId m
          , Accessible ClientSecret m
          , Accessible MasterClientId m
          , Accessible MasterClientSecret m
          ) => ServerT IDAPI.IdentityProviderAPI m
server = getPingIdentity :<|> putIdentity :<|> putIdentityExternal

hoistCoreServer :: String 
                -> String 
                -> Issuer 
                -> X509Certificate 
                -> PrivateKey
                -> String
                -> String
                -> String
                -> String
                -> Server IDAPI.IdentityProviderAPI
hoistCoreServer nodeurl vaulturl iss cert privk cid cs mid ms = hoistServer (Proxy :: Proxy IDAPI.IdentityProviderAPI) (convertErrors runM') server
  where
    convertErrors r x = Handler $ do
      eRes <- liftIO . try $ r x
      case eRes of
        Right a -> return a
        Left e -> throwE $ reThrowError e
    runM' :: ReaderT IdentityServerData (VaultM (LoggingT IO)) x -> IO x
    runM' x = runLoggingT . runVaultM vaulturl $ runIdentityM nodeurl iss cert privk cid cs mid ms x
    reThrowError :: IdentityError -> ServerError
    reThrowError
      = \case
          IdentityError err -> err400{errBody = BL.fromStrict $ encodeUtf8 err}

runIdentityM :: MonadIO m
             => String 
             -> Issuer 
             -> X509Certificate 
             -> PrivateKey
             -> String
             -> String
             -> String
             -> String
             -> ReaderT IdentityServerData m a -> m a
runIdentityM nodeurl iss cert privk cid cs mid ms x = do 
    url <- liftIO $ parseBaseUrl nodeurl
    let path' = baseUrlPath url
    let pathToBlocApi = path' <> (if "/" `isSuffixOf` path' then "" else "/") <> blocEndpoint -- surely there is a better way to do this?
    runReaderT x $ IdentityServerData iss cert privk url{baseUrlPath=pathToBlocApi} (ClientId cid) (ClientSecret cs) (MasterClientId mid) (MasterClientSecret ms)


identityProviderApp :: String 
                    -> String 
                    -> Issuer 
                    -> X509Certificate 
                    -> PrivateKey
                    -> String
                    -> String
                    -> String
                    -> String
                    -> Application
identityProviderApp nurl vurl iss cert pk cid cs mid ms = serve (Proxy :: Proxy IDAPI.IdentityProviderAPI) $ hoistCoreServer nurl vurl iss cert pk cid cs mid ms