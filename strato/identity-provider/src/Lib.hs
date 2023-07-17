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
{-# OPTIONS_GHC -fno-warn-orphans  #-}

module Lib
    ( AccessToken
    , getAccessToken
    , OAuthUser
    , identityProviderApp
    , putIdentity
    , getUserByUUID
    , oAuthUserToSubject
    , hoistCoreServer
    , server
    )
where

import           UnliftIO                                hiding (Handler)
import           Servant
import           Servant.Client                          hiding (responseBody, manager)
import           Network.HTTP.Client                     hiding (Proxy)
import           Network.HTTP.Client.TLS
import           Network.HTTP.Types.Header               (hContentType, hAuthorization)

import           Data.Aeson
<<<<<<< HEAD
import           Data.ByteString.Base64
import qualified Data.ByteString.UTF8 as B                    (fromString)
import           Data.List                               (isSuffixOf)
import qualified Data.Map as M
=======
import qualified Data.ByteString.Base64                  as B64
import qualified Data.ByteString.Lazy                    as BL
>>>>>>> 08fb920... Began refactoring identity-provider code to pass everything in as flags
import           Data.Text as T                          (Text, unpack, pack, take)
import           Data.Text.Encoding                      (encodeUtf8, decodeUtf8)
import           GHC.Generics

import           Bloc.API.Transaction
import           Bloc.Client
import           BlockApps.Solidity.ArgValue
import           BlockApps.X509
import           Blockchain.Strato.Model.Secp256k1       hiding (HasVault)
import           Strato.Strato23.API
import           Strato.Strato23.Client

import           Control.Monad.Change.Modify
import           Control.Monad.Composable.Vault
import           Control.Monad.Reader
<<<<<<< HEAD
=======
import           Control.Monad.Trans.Except
>>>>>>> 08fb920... Began refactoring identity-provider code to pass everything in as flags
import           BlockApps.Logging
import           Options

data IdentityError
  = UserError Text
  deriving (Show, Exception)

newtype AccessToken = AccessToken {access_token :: T.Text} deriving (Show, Generic)
instance FromJSON AccessToken
instance ToJSON AccessToken

getAccessToken :: ( MonadIO m
                  , Accessible MasterClientId m
                  , Accessible MasterClientSecret m
                  ) => m (Maybe AccessToken)
getAccessToken = do
<<<<<<< HEAD
    manager <- liftIO $ newManager tlsManagerSettings
    MasterClientId mcid <- access Proxy
    MasterClientSecret msec <- access Proxy
    let creds64 = encodeBase64' . B.fromString $ mcid <> ":" <> msec
    templateRequest <- liftIO $ parseRequest "POST https://keycloak.blockapps.net/auth/realms/master/protocol/openid-connect/token" -- todo: make these into flags
    let rBody = RequestBodyLBS "grant_type=password"
        rHead = [(hContentType, "application/x-www-form-urlencoded"), (hAuthorization, "Basic " <> creds64)]
        request = templateRequest{requestHeaders = rHead, requestBody = rBody}
    response <- liftIO $ httpLbs request manager
=======
    manager <- newManager defaultManagerSettings
    templateRequest <- parseRequest $ concat ["POST ", flags_OAUTH_PROVIDER_URL, flags_OAUTH_TOKEN_ENDPOINT]
    let rBody = RequestBodyLBS . BL.fromStrict . encodeUtf8 . T.pack $
          concat [ "grant_type=password&username="
                 , flags_OAUTH_ADMIN_USERNAME
                 , "&password="
                 , flags_OAUTH_ADMIN_PASSWORD
                 ]-- TODO: Use client-credential flow if possible
        authString = B64.encodeBase64 . encodeUtf8 . T.pack $ concat [flags_OAUTH_CLIENT_ID, ":", flags_OAUTH_CLIENT_SECRET]
        rHead = [(hContentType, "application/x-www-form-urlencoded"), (hAuthorization, encodeUtf8 $ "Basic " <> authString)]
        request = templateRequest{requestHeaders=rHead, requestBody = rBody}
    response <- httpLbs request manager
>>>>>>> 08fb920... Began refactoring identity-provider code to pass everything in as flags
    return $ decode $ responseBody response

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
        Just (OAuthUserAttributes (Just (org:_))) -> T.unpack org
        _ -> head firstN : lastN ++ T.unpack (T.take 8 id')
    ,
    subUnit = Nothing,
    subCountry = Nothing,
    subPub = pk
}

getUserByUUID :: ( MonadIO m
                 , Accessible RealmName m
                 ) => AccessToken -> T.Text -> m (Either String OAuthUser)
getUserByUUID token uuid = do
<<<<<<< HEAD
    manager <- liftIO $ newManager tlsManagerSettings
    RealmName realm <- access Proxy
    let url = "https://keycloak.blockapps.net/auth/admin/realms/" <> T.pack realm <> "/users/" <> uuid
    templateRequest <- liftIO $ parseRequest $ T.unpack url
    let rHead = [(hContentType, "application/json"), (hAuthorization, encodeUtf8 $ "Bearer " <> access_token token)]
=======
    manager <- newManager defaultManagerSettings
    templateRequest <- parseRequest $ concat [flags_OAUTH_PROVIDER_URL, flags_OAUTH_USER_ENDPOINT, "/", T.unpack uuid]
    let rHead = [(hContentType, "application/json"), (hAuthorization, encodeUtf8 $ "Bearer " <> (access_token token))]
>>>>>>> 08fb920... Began refactoring identity-provider code to pass everything in as flags
        request = templateRequest{requestHeaders=rHead}
    response <- liftIO $ httpLbs request manager
    return $ eitherDecode $ responseBody response


<<<<<<< HEAD
newtype MasterClientId = MasterClientId String 
newtype MasterClientSecret = MasterClientSecret String
newtype RealmName = RealmName String
data IdentityServerData = IdentityServerData 
    { issuer             :: Issuer          -- issuer of signing cert
    , issuerCert         :: X509Certificate -- the signing cert
    , issuerPrivKey      :: PrivateKey      -- the signing private key
    , blocAPIUrl         :: BaseUrl -- strato node where will register cert
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
instance {-# OVERLAPPING #-} Monad m => Accessible MasterClientId (ReaderT IdentityServerData m) where 
    access _ = asks masterClientId
instance {-# OVERLAPPING #-} Monad m => Accessible MasterClientSecret (ReaderT IdentityServerData m) where 
    access _ = asks masterClientSecret
instance {-# OVERLAPPING #-} Monad m => Accessible RealmName (ReaderT IdentityServerData m) where 
    access _ = asks realmName
=======
data CertIssuer = CertIssuer 
    { issuer        :: Issuer
    , issuerCert    :: X509Certificate
    , issuerPrivKey :: PrivateKey
    }
instance Monad m => Accessible Issuer (ReaderT CertIssuer m) where 
    access _ = asks issuer
instance Monad m => Accessible X509Certificate (ReaderT CertIssuer m) where 
    access _ = asks issuerCert
instance Monad m => Accessible PrivateKey (ReaderT CertIssuer m) where 
    access _ = asks issuerPrivKey
instance Monad m => Accessible VaultData (VaultM m) where
  access _ = ask
instance (Monad m, Accessible VaultData m) => Accessible VaultData (ReaderT CertIssuer m) where 
    access = lift . access

>>>>>>> 08fb920... Began refactoring identity-provider code to pass everything in as flags

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
               , Accessible MasterClientId m
               , Accessible MasterClientSecret m
               , Accessible RealmName m
               ) => T.Text -> T.Text -> m Address
putIdentity accessToken uuid = do
    $logInfoS "putIdentity" "someone called PUT /identity"
    -- first check if a user exists in vault
    getVaultKey accessToken >>= \case
        Just a -> return a
        Nothing -> do -- no vault key, so make key and register cert
            mAddressNKey <- postVaultKey accessToken
<<<<<<< HEAD
            case mAddressNKey of 
                Nothing -> do
                    $logErrorS "putIdentity" $ "error occurred while trying to create vault key for user with uuid " <> uuid
                    -- TODO: should throw error in nothing case, not return dummy val
                    return $ Address 0x509
                Just (AddressAndKey a k) -> do
                    mToken <- getAccessToken
                    case mToken of 
                        Nothing -> do
                            error "uh oh! We couldn't get our access token" -- TODO: better error handling than this
=======
            addr <- case mAddressNKey of 
                Nothing -> throwIO . UserError $ "error occurred while trying to create vault key for user with uuid " <> uuid
                Just (AddressAndKey a k) -> do
                    mToken <- liftIO getAccessToken
                    case mToken of 
                        Nothing -> throwIO . UserError $ "uh oh! We couldn't get our access token"
>>>>>>> 08fb920... Began refactoring identity-provider code to pass everything in as flags
                        Just token -> do
                            eUser <- getUserByUUID token uuid
                            case eUser of
                                Left err -> throwIO . UserError $ "Error occurred while trying to get user with uuid " <> uuid <> ": " <> T.pack err
                                Right user -> do 
                                    i <- access (Proxy @Issuer) 
                                    c <- access (Proxy @X509Certificate)
                                    iK <- access (Proxy @PrivateKey)
                                    let signWIssuerPrivKey bs = return $ signMsg iK bs
<<<<<<< HEAD
                                    mNewCert <- makeSignedCertSigF signWIssuerPrivKey Nothing (Just c) i (oAuthUserToSubject user k)
                                    case mNewCert of 
                                        Just newCert -> registerCert newCert accessToken
                                        Nothing -> $logErrorS "putIdentity" "Error signing new cert"
                    return a

registerCert :: (MonadIO m, MonadLogger m, Accessible BaseUrl m) => X509Certificate -> T.Text -> m ()
registerCert cert accessToken = do 
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
    eresponse <- liftIO $ runClientM (postBlocTransactionExternal (Just $ "Bearer " <> accessToken) Nothing True txRequest) clientEnv
    $logInfoS "registerCert" $ T.pack $ "Response after registering cert was: " ++ show eresponse 
=======
                                    _ <- makeSignedCertSigF signWIssuerPrivKey Nothing (Just c) i (oAuthUserToSubject user k)
                                    return a
            return addr
>>>>>>> 08fb920... Began refactoring identity-provider code to pass everything in as flags

-- note to self: what if error is serious?
getVaultKey :: (MonadIO m, MonadLogger m, HasVault m) => T.Text -> m (Maybe Address)
getVaultKey accessToken = do 
    VaultData url mgr <- access Proxy   
    eAddressNKey <- liftIO $ runClientM (getKey (Just accessToken) Nothing) (mkClientEnv mgr url)
    $logInfoS "getVaultKey" $ T.pack $ "response is " <> show eAddressNKey
    case eAddressNKey of 
        Right (AddressAndKey a _) -> return $ Just a
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
                -> Server IdentityProviderAPI
hoistCoreServer nodeurl vaulturl iss cert privk mid ms rn = hoistServer (Proxy :: Proxy IdentityProviderAPI) (convertErrors runM') server
  where
<<<<<<< HEAD
    -- convertErrors :: LoggingT IO a -> Handler a
    convertErrors r x = Handler $ liftIO $ r x
    runM' :: ReaderT IdentityServerData (VaultM (LoggingT IO)) x -> IO x
    runM' x = runLoggingT . runVaultM vaulturl $ runIdentityM nodeurl iss cert privk mid ms rn x

runIdentityM :: MonadIO m
             => String 
             -> Issuer 
             -> X509Certificate 
             -> PrivateKey
             -> String
             -> String
             -> String
             -> ReaderT IdentityServerData m a -> m a
runIdentityM nodeurl iss cert privk mid ms rn x = do 
    url <- liftIO $ parseBaseUrl nodeurl
    let path' = baseUrlPath url
    let pathToBlocApi = path' <> (if "/" `isSuffixOf` path' then "" else "/") <> "bloc/v2.2" -- surely there is a better way to do this?
    runReaderT x $ IdentityServerData iss cert privk url{baseUrlPath=pathToBlocApi} (MasterClientId mid) (MasterClientSecret ms) (RealmName rn)
=======
    convertErrors r x = Handler $ do
      eRes <- liftIO . try $ r x
      case eRes of
        Right a -> return a
        Left e -> throwE $ reThrowError e
    runM' :: ReaderT CertIssuer (VaultM (LoggingT IO)) x -> IO x
    runM' x = runLoggingT . runVaultM vaulturl $ runReaderT x ci
    reThrowError :: IdentityError -> ServerError
    reThrowError
      = \case
          UserError err -> err400{errBody = BL.fromStrict $ encodeUtf8 err}
>>>>>>> 08fb920... Began refactoring identity-provider code to pass everything in as flags

identityProviderApp :: String 
                    -> String 
                    -> Issuer 
                    -> X509Certificate 
                    -> PrivateKey
                    -> String
                    -> String
                    -> String
                    -> Application
identityProviderApp nurl vurl iss cert pk mid ms rn = serve (Proxy :: Proxy IdentityProviderAPI) $ hoistCoreServer nurl vurl iss cert pk mid ms rn