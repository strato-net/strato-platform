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
import           Network.HTTP.Types.Header               (hContentType, hAuthorization)

import           Data.Aeson
import           Data.Text as T                          (Text, unpack, pack, take)
import           Data.Text.Encoding                      (encodeUtf8)
import           GHC.Generics
-- import           Blockchain.Strato.Model.Address ()
import           BlockApps.X509
import           Blockchain.Strato.Model.Secp256k1       hiding (HasVault)
import           Strato.Strato23.API
import           Strato.Strato23.Client

import           Control.Monad.Change.Modify
import           Control.Monad.Composable.Vault
import           Control.Monad.Reader
-- import           Control.Monad.Trans.Resource
import           BlockApps.Logging

import           SelectAccessible                () --TODO: fix this import because it comes from slipstream (see note in package.yml)

newtype AccessToken = AccessToken {access_token :: T.Text} deriving (Show, Generic)
instance FromJSON AccessToken
instance ToJSON AccessToken

getAccessToken :: IO (Maybe AccessToken)
getAccessToken = do
    manager <- newManager defaultManagerSettings
    templateRequest <- parseRequest "POST http://localhost:8080/realms/master/protocol/openid-connect/token" -- todo: make these into flags
    let rBody = RequestBodyLBS "grant_type=password&username=admin&password=admin"
        rHead = [(hContentType, "application/x-www-form-urlencoded"), (hAuthorization, "Basic YWRtaW4tY2xpOlBrbnRGaGxjS3E0RWE5UzhPNlI5RW0xSjhpdFRaVmZY")]
        request = templateRequest{requestHeaders=rHead, requestBody = rBody}
    response <- httpLbs request manager
    return $ decode $ responseBody response

newtype OAuthUserAttributes = OAuthUserAttributes {companyName :: Maybe [T.Text]} deriving (Show, Generic)
instance FromJSON OAuthUserAttributes
instance ToJSON OAuthUserAttributes
data OAuthUser = OAuthUser {
    id          :: T.Text, --untested
    firstName   :: T.Text,
    lastName    :: T.Text,
    attributes  :: Maybe OAuthUserAttributes -- Maybe (Map T.Text [T.Text])
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

getUserByUUID :: AccessToken -> T.Text -> IO (Either String OAuthUser)
getUserByUUID token uuid = do
    manager <- newManager defaultManagerSettings
    templateRequest <- parseRequest $ T.unpack $ "http://localhost:8080/admin/realms/myrealm/users/" <> uuid
    let rHead = [(hContentType, "application/json"), (hAuthorization, encodeUtf8 $ "Bearer " <> (access_token token))]
        request = templateRequest{requestHeaders=rHead}
    response <- httpLbs request manager
    return $ eitherDecode $ responseBody response

type GetPingIdentity = "_ping" :> Get '[JSON] Int

getPingIdentity ::  (MonadIO m) => m Int
getPingIdentity = return $ 1

data CertIssuer = CertIssuer 
    { issuer        :: Issuer
    , issuerCert    :: X509Certificate
    , issuerPrivKey :: PrivateKey
    }
instance {-# OVERLAPPING #-} Monad m => Accessible Issuer (ReaderT CertIssuer m) where 
    access _ = asks issuer
instance {-# OVERLAPPING #-} Monad m => Accessible X509Certificate (ReaderT CertIssuer m) where 
    access _ = asks issuerCert
instance {-# OVERLAPPING #-} Monad m => Accessible PrivateKey (ReaderT CertIssuer m) where 
    access _ = asks issuerPrivKey


type PutIdentity = "identity"
                -- :> Header' '[Required, Strict] "Authorization" T.Text -- pass along for vault calls
                :> Header' '[Required, Strict] "X-ACCESS-USER-TOKEN" T.Text -- pass along for vault calls
                :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" T.Text -- need for keycloak query
                -- maybe in the future we can support "X-IDENTITY-PROVIDER" header too
                :> Put '[JSON] Address --should return cert address
--realm name should be flag
--node url should also be a flag
--add client binding to tx endpoint (then call it)

type IdentityProviderAPI =  GetPingIdentity :<|> PutIdentity 

putIdentity :: ( MonadIO m
               , MonadLogger m
               , HasVault m
               , Accessible Issuer m
               , Accessible X509Certificate m
               , Accessible PrivateKey m
               ) => T.Text -> T.Text -> m Address
putIdentity accessToken uuid = do
    $logInfoS "putIdentity" "someone called PUT /identity"
    -- first check if a user exists in vault
    getVaultKey accessToken >>= \case
        Just a -> return a
        Nothing -> do -- no vault key, so make key and register cert
            mAddressNKey <- postVaultKey accessToken
            _ <- case mAddressNKey of 
                Nothing -> $logErrorS "putIdentity" $ "error occurred while trying to create vault key for user with uuid " <> uuid
                Just (AddressAndKey _ k) -> do
                    mToken <- liftIO getAccessToken
                    case mToken of 
                        Nothing -> error "uh oh! We couldn't get our access token" -- TODO: better error handling than this
                        Just token -> do
                            eUser <- liftIO $ getUserByUUID token uuid
                            case eUser of
                                Left err -> $logErrorS "putIdentity" $ "Error occurred while trying to get user with uuid " <> uuid <> ": " <> T.pack err
                                Right user -> do 
                                    i <- access (Proxy @Issuer) 
                                    c <- access (Proxy @X509Certificate)
                                    iK <- access (Proxy @PrivateKey)
                                    let signWIssuerPrivKey bs = return $ signMsg iK bs
                                    _ <- makeSignedCertSigF signWIssuerPrivKey Nothing (Just c) i (oAuthUserToSubject user k)
                                    return ()
            return $ Address 0x509

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
          ) => ServerT IdentityProviderAPI m
server = getPingIdentity :<|> putIdentity

hoistCoreServer :: String -> CertIssuer -> Server IdentityProviderAPI
hoistCoreServer vaulturl ci = hoistServer (Proxy :: Proxy IdentityProviderAPI) (convertErrors runM') server
  where
    -- convertErrors :: LoggingT IO a -> Handler a
    convertErrors r x = Handler $ liftIO $ r x
    runM' :: ReaderT CertIssuer (VaultM (LoggingT IO)) x -> IO x
    runM' x = runLoggingT . runVaultM vaulturl $ runReaderT x ci

identityProviderApp :: String -> Issuer -> X509Certificate -> PrivateKey -> Application
identityProviderApp vaulturl iss cert privk = serve (Proxy :: Proxy IdentityProviderAPI) $ hoistCoreServer vaulturl (CertIssuer iss cert privk)