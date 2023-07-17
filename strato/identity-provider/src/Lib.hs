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
import           Network.HTTP.Client.TLS
import           Network.HTTP.Types.Header               (hContentType, hAuthorization)

import           Data.Aeson
import           Data.List                               (isSuffixOf)
import qualified Data.Map as M
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

data IdentityServerData = IdentityServerData 
    { issuer        :: Issuer          -- issuer of signing cert
    , issuerCert    :: X509Certificate -- the signing cert
    , issuerPrivKey :: PrivateKey      -- the signing private key
    , blocAPIUrl       :: BaseUrl      -- strato node where will register cert
    }

runIdentityM :: MonadIO m => String -> Issuer -> X509Certificate -> PrivateKey -> ReaderT IdentityServerData m a -> m a
runIdentityM nodeurl iss cert privk r = do 
    url <- liftIO $ parseBaseUrl nodeurl
    let path' = baseUrlPath url
    let pathToBlocApi = path' <> (if "/" `isSuffixOf` path' then "" else "/") <> "bloc/v2.2" -- surely there is a better way to do this?
    runReaderT r $ IdentityServerData iss cert privk url{baseUrlPath=pathToBlocApi}

instance {-# OVERLAPPING #-} Monad m => Accessible Issuer (ReaderT IdentityServerData m) where 
    access _ = asks issuer
instance {-# OVERLAPPING #-} Monad m => Accessible X509Certificate (ReaderT IdentityServerData m) where 
    access _ = asks issuerCert
instance {-# OVERLAPPING #-} Monad m => Accessible PrivateKey (ReaderT IdentityServerData m) where 
    access _ = asks issuerPrivKey
instance {-# OVERLAPPING #-} Monad m => Accessible BaseUrl (ReaderT IdentityServerData m) where 
    access _ = asks blocAPIUrl


type PutIdentity = "identity"
                :> Header' '[Required, Strict] "X-ACCESS-USER-TOKEN" T.Text -- pass along for vault calls
                :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" T.Text -- need for keycloak query
                :> Put '[JSON] Address --should return cert address

type IdentityProviderAPI =  PutIdentity --only 1 endpoint

putIdentity :: ( MonadIO m
               , MonadLogger m
               , HasVault m
               , Accessible Issuer m
               , Accessible X509Certificate m
               , Accessible PrivateKey m
               , Accessible BaseUrl m
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
                                    mNewCert <- makeSignedCertSigF signWIssuerPrivKey Nothing (Just c) i (oAuthUserToSubject user k)
                                    case mNewCert of 
                                        Just newCert -> registerCert newCert accessToken
                                        Nothing -> $logErrorS "putIdentity" "Error signing new cert"
                                    return ()
            return $ Address 0x509

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
          ) => ServerT IdentityProviderAPI m
server = putIdentity

hoistCoreServer :: String -> String -> Issuer -> X509Certificate -> PrivateKey -> Server IdentityProviderAPI
hoistCoreServer nodeurl vaulturl iss cert privk = hoistServer (Proxy :: Proxy IdentityProviderAPI) (convertErrors runM') server
  where
    -- convertErrors :: LoggingT IO a -> Handler a
    convertErrors r x = Handler $ liftIO $ r x
    runM' :: ReaderT IdentityServerData (VaultM (LoggingT IO)) x -> IO x
    runM' x = runLoggingT . runVaultM vaulturl $ runIdentityM nodeurl iss cert privk x

identityProviderApp :: String -> String -> Issuer -> X509Certificate -> PrivateKey -> Application
identityProviderApp nodeurl vaulturl iss cert privk = serve (Proxy :: Proxy IdentityProviderAPI) $ hoistCoreServer nodeurl vaulturl iss cert privk