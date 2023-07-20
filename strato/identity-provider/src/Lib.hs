{-# LANGUAGE DataKinds             #-}
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

module Lib
    ( AccessToken
    , OAuthUser
    , identityProviderApp
    , putIdentity
    , getUserByUUID
    , oAuthUserToSubject
    , hoistCoreServer
    , server
    , getVaultKey
    )
where

import           UnliftIO                                hiding (Handler)
import           Servant                                 hiding (ServerError)
import           Servant.Client                          hiding (responseBody, manager)
import           Network.HTTP.Client                     hiding (Proxy)
import           Network.HTTP.Client.TLS
import           Network.HTTP.Types.Header               (hContentType, hAuthorization)

import           Data.Aeson
import           Data.ByteString.Base64
import qualified Data.ByteString.UTF8 as B                    (fromString)
import           Data.List                               (isSuffixOf)
import qualified Data.Map as M
import qualified Data.Text as T                          (Text, unpack, pack, take, replace, null)
import           Data.Text.Encoding                      (encodeUtf8, decodeUtf8)
import           GHC.Generics

import           Bloc.API.Transaction
import           Bloc.Client
import           BlockApps.Solidity.ArgValue
import           BlockApps.X509                          hiding (isValid)
import           Blockchain.Strato.Model.Secp256k1       hiding (HasVault)
import           Strato.Strato23.API
import           Strato.Strato23.Client

import           Control.Monad.Change.Modify
import           Control.Monad.Composable.Vault
import           Control.Monad.Reader
import           BlockApps.Logging

import           SelectAccessible                () --TODO: fix this import because it comes from slipstream (see note in package.yml)

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
                       , Accessible RealmName m
                       ) => m (Maybe AccessToken)
getRealmAccessToken = do 
    ClientId cid <- access Proxy 
    ClientSecret csec <- access Proxy
    RealmName realm <- access Proxy
    getAccessToken cid csec realm

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
                 , Accessible RealmName m
                 ) => AccessToken -> T.Text -> m (Either String OAuthUser)
getUserByUUID token uuid = do
    manager <- liftIO $ newManager tlsManagerSettings
    RealmName realm <- access Proxy
    let url = "https://keycloak.blockapps.net/auth/admin/realms/" <> T.pack realm <> "/users/" <> uuid
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
newtype RealmName = RealmName String
data IdentityServerData = IdentityServerData 
    { issuer             :: Issuer          -- issuer of signing cert
    , issuerCert         :: X509Certificate -- the signing cert
    , issuerPrivKey      :: PrivateKey      -- the signing private key
    , blocAPIUrl         :: BaseUrl -- strato node where will register cert
    , clientId           :: ClientId
    , clientSecret       :: ClientSecret
    , masterClientId     :: MasterClientId
    , masterClientSecret :: MasterClientSecret
    , realmName          :: RealmName
}
instance {-# OVERLAPPING #-} Monad m => Accessible Issuer (ReaderT IdentityServerData m) where 
    access _ = asks issuer
instance {-# OVERLAPPING #-} Monad m => Accessible X509Certificate (ReaderT IdentityServerData m) where 
    access _ = asks issuerCert
instance {-# OVERLAPPING #-} Monad m => Accessible PrivateKey (ReaderT IdentityServerData m) where 
    access _ = asks issuerPrivKey
instance {-# OVERLAPPING #-} Monad m => Accessible BaseUrl (ReaderT IdentityServerData m) where 
    access _ = asks blocAPIUrl
instance {-# OVERLAPPING #-} Monad m => Accessible ClientId (ReaderT IdentityServerData m) where 
    access _ = asks clientId
instance {-# OVERLAPPING #-} Monad m => Accessible ClientSecret (ReaderT IdentityServerData m) where 
    access _ = asks clientSecret
instance {-# OVERLAPPING #-} Monad m => Accessible MasterClientId (ReaderT IdentityServerData m) where 
    access _ = asks masterClientId
instance {-# OVERLAPPING #-} Monad m => Accessible MasterClientSecret (ReaderT IdentityServerData m) where 
    access _ = asks masterClientSecret
instance {-# OVERLAPPING #-} Monad m => Accessible RealmName (ReaderT IdentityServerData m) where 
    access _ = asks realmName

type PutIdentity = "identity"
                :> Header' '[Required, Strict] "X-ACCESS-USER-TOKEN" T.Text -- pass along for vault calls
                :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" T.Text -- need for keycloak query
                :> Put '[JSON] Address --should return user address
type GetPingIdentity = "_ping" :> Get '[JSON] Int

type IdentityProviderAPI =  GetPingIdentity :<|> PutIdentity 

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
               , Accessible RealmName m
               ) => T.Text -> T.Text -> m Address
putIdentity accessToken uuid = do
    $logInfoS "putIdentity" "someone called PUT /identity"
    -- first check if a user exists in vault
    getVaultKey accessToken >>= \case
        Just (AddressAndKey a k) -> do -- has vault key, confirm also has cert
            hasCert <- certInCirrus accessToken a
            unless hasCert $ createAndRegisterCert uuid k
            return a
        Nothing -> do -- no vault key, so make key and register cert
            postVaultKey accessToken >>= \case
                Nothing -> do
                    $logErrorS "putIdentity" $ "error occurred while trying to create vault key for user with uuid " <> uuid
                    -- TODO: should throw error in nothing case, not return dummy val
                    -- refactor so either throw error or return AddressAndKey (no Maybe wrapper)
                    -- throwIO $ ServerError "Could not create vault keys" 
                    return $ Address 0x509
                Just (AddressAndKey a k) -> do
                    createAndRegisterCert uuid k
                    return a

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
                         , Accessible RealmName m
                         ) => T.Text -> PublicKey -> m ()
createAndRegisterCert uuid k = do 
    getMasterAccessToken >>= \case 
        Nothing -> error "uh oh! We couldn't get an access token for the master realm" -- TODO: better error handling than this
        Just masterToken -> do
            getUserByUUID masterToken uuid >>= \case
                Left err -> $logErrorS "createAndRegisterCert" $ "Error occurred while trying to get information on user with uuid " <> uuid <> ": " <> T.pack err
                Right user -> do             
                    createNewCert user k >>= \case 
                        Just newCert -> do
                            getRealmAccessToken >>= \case 
                                Nothing -> error "uh oh! We couldn't an access token for our realm" -- TODO: better error handling than this
                                Just realmToken -> registerCert newCert realmToken
                        Nothing -> $logErrorS "createAndRegisterCert" $ "Error occurred while trying to sign a cert for user " <> uuid

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

-- note to self: what if error is serious?
getVaultKey :: (MonadIO m, MonadLogger m, HasVault m) => T.Text -> m (Maybe AddressAndKey)
getVaultKey accessToken = do 
    VaultData url mgr <- access Proxy   
    eAddressNKey <- liftIO $ runClientM (getKey (Just accessToken) Nothing) (mkClientEnv mgr url)
    $logInfoS "getVaultKey" $ T.pack $ "response is " <> show eAddressNKey
    case eAddressNKey of 
        Right a -> return $ Just a
        -- Left ClientError FailureResponse; maybe use responseStatusCode to figure out which vault error (no user or incorrect pw?)
        -- ideally w/o hard coding though :(
        Left err -> do 
            $logErrorS "getVaultKey" $ T.pack $ "error fetching user's pubkey: " <> show err
            return Nothing

postVaultKey :: (MonadIO m, MonadLogger m, HasVault m) => T.Text -> m (Maybe AddressAndKey)
postVaultKey accessToken = do
    VaultData url mgr <- access Proxy
    eAddressNKey <- liftIO $ runClientM (postKey (Just accessToken)) (mkClientEnv mgr url)
    $logInfoS "postVaultKey" $ T.pack $ "response is " <> show eAddressNKey
    case eAddressNKey of 
        Right a -> return $ Just a
        Left err -> do 
            $logErrorS "postVaultKey" $ T.pack $ "error posting user's pubkey: " <> show err
            return Nothing

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
          , Accessible RealmName m
          ) => ServerT IdentityProviderAPI m
server = getPingIdentity :<|> putIdentity

hoistCoreServer :: String 
                -> String 
                -> Issuer 
                -> X509Certificate 
                -> PrivateKey
                -> String
                -> String
                -> String
                -> String
                -> String
                -> Server IdentityProviderAPI
hoistCoreServer nodeurl vaulturl iss cert privk cid cs mid ms rn = hoistServer (Proxy :: Proxy IdentityProviderAPI) (convertErrors runM') server
  where
    -- convertErrors :: LoggingT IO a -> Handler a
    convertErrors r x = Handler $ liftIO $ r x
    runM' :: ReaderT IdentityServerData (VaultM (LoggingT IO)) x -> IO x
    runM' x = runLoggingT . runVaultM vaulturl $ runIdentityM nodeurl iss cert privk cid cs mid ms rn x

runIdentityM :: MonadIO m
             => String 
             -> Issuer 
             -> X509Certificate 
             -> PrivateKey
             -> String
             -> String
             -> String
             -> String
             -> String
             -> ReaderT IdentityServerData m a -> m a
runIdentityM nodeurl iss cert privk cid cs mid ms rn x = do 
    url <- liftIO $ parseBaseUrl nodeurl
    let path' = baseUrlPath url
    let pathToBlocApi = path' <> (if "/" `isSuffixOf` path' then "" else "/") <> blocEndpoint -- surely there is a better way to do this?
    runReaderT x $ IdentityServerData iss cert privk url{baseUrlPath=pathToBlocApi} (ClientId cid) (ClientSecret cs) (MasterClientId mid) (MasterClientSecret ms) (RealmName rn)

identityProviderApp :: String 
                    -> String 
                    -> Issuer 
                    -> X509Certificate 
                    -> PrivateKey
                    -> String
                    -> String
                    -> String
                    -> String
                    -> String
                    -> Application
identityProviderApp nurl vurl iss cert pk cid cs mid ms rn = serve (Proxy :: Proxy IdentityProviderAPI) $ hoistCoreServer nurl vurl iss cert pk cid cs mid ms rn