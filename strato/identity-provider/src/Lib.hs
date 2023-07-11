{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE DeriveFunctor         #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE PolyKinds             #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeFamilies          #-}
{-# LANGUAGE UndecidableInstances  #-}
{-# LANGUAGE StandaloneDeriving #-}

module Lib
    ( AccessToken
    , getAccessToken
    , OAuthUser
    , identityProviderApp
    , putIdentity
    , getUserByUUID
    , runContextM'
    , hoistCoreServer
    , server
    )
where

import           UnliftIO                                hiding (Handler)
import           Servant
import           Servant.Client hiding (responseBody, manager)
import           Network.HTTP.Client hiding (Proxy)
import           Network.HTTP.Types.Header (hContentType, hAuthorization)

import           Data.Aeson
import           Data.Text (Text, unpack, pack)
import           Data.Text.Encoding (encodeUtf8)
import           GHC.Generics
import           Blockchain.Strato.Model.Address (Address(..))
import           Strato.Strato23.Client

import           Control.Monad.Change.Modify
import           Control.Monad.Composable.Vault
import           Control.Monad.Reader
import           Control.Monad.Trans.Resource
import           BlockApps.Logging

import           SelectAccessible                ()

newtype AccessToken = AccessToken {access_token :: Text} deriving (Show, Generic)
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

newtype OAuthUserAttributes = OAuthUserAttributes {companyName :: Maybe [Text]} deriving (Show, Generic)
instance FromJSON OAuthUserAttributes
instance ToJSON OAuthUserAttributes
data OAuthUser = OAuthUser {
    firstName   :: Text,
    lastName    :: Text,
    attributes  :: Maybe OAuthUserAttributes -- Maybe (Map Text [Text])
} deriving (Show, Generic)
instance FromJSON OAuthUser
instance ToJSON OAuthUser

getUserByUUID :: AccessToken -> Text -> IO (Either String OAuthUser)
getUserByUUID token uuid = do
    manager <- newManager defaultManagerSettings
    templateRequest <- parseRequest $ unpack $ "http://localhost:8080/admin/realms/myrealm/users/" <> uuid
    let rHead = [(hContentType, "application/json"), (hAuthorization, encodeUtf8 $ "Bearer " <> (access_token token))]
        request = templateRequest{requestHeaders=rHead}
    response <- httpLbs request manager
    return $ eitherDecode $ responseBody response

-- newtype IDServerVaultConn = IDServerVaultConn {vaultConn :: ClientEnv}

type PutIdentity = "identity"
                :> Header' '[Required, Strict] "Authorization" Text -- pass along for vault calls
                -- :> Header' '[Required, Strict] "X-ACCESS-USER-TOKEN" Text -- pass along for vault calls
                :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text -- need for keycloak query
                -- maybe in the future we can support "X-IDENTITY-PROVIDER" header too
                :> Put '[JSON] Address --should return cert address
--realm name should be flag
--node url should also be a flag
--root cert just files on server's file system (flag to point to files)
--use makeSignedCert function (or refactor the x509-gen tool)
--add client binding to tx endpoint (then call it)
type IdentityProviderAPI =  PutIdentity --only 1 endpoint

-- use vault client bindings
putIdentity :: (MonadIO m, MonadLogger m, HasVault m) => Text -> Text -> m Address
putIdentity accessToken _ = do
    -- first check if a user exists in vault
    VaultData url mgr <- access Proxy
    -- raw http request way
    -- let keyUrlPath = baseUrlPath url <> "/key"
    -- templateRequest <- liftIO $ parseRequest $ showBaseUrl url{baseUrlPath=keyUrlPath}
    -- let rHead = [(hAuthorization, encodeUtf8 accessToken)]
    --     request = templateRequest{requestHeaders=rHead}
    -- k <- liftIO $ httpLbs request mgr

    -- this is the client binding version
    k <- liftIO $ runClientM (getKey (Just accessToken) Nothing) (mkClientEnv mgr url)
    $logInfoS "putIdentity" "just returning x509"
    $logInfoS "putIdentity" $ pack $ "response is " <> show k --(responseBody response)
    return $ Address 0x509

runContextM' :: MonadUnliftIO m
            => r
            -> ReaderT r (ResourceT m) a
            -> m ()
runContextM' r = void . runResourceT . flip runReaderT r     

server :: (MonadIO m, MonadLogger m, HasVault m) => ServerT IdentityProviderAPI m
server = putIdentity


hoistCoreServer :: String -> Server IdentityProviderAPI
hoistCoreServer vaulturl = hoistServer (Proxy :: Proxy IdentityProviderAPI) (convertErrors runM') server
  where
    -- convertErrors :: LoggingT IO a -> Handler a
    convertErrors r x = Handler $ liftIO $ r x
    runM' :: ReaderT VaultData (LoggingT IO) x -> IO x
    runM' x = runLoggingT $ runVaultM vaulturl x

identityProviderApp :: String -> Application
identityProviderApp vaulturl = serve (Proxy :: Proxy IdentityProviderAPI) $ hoistCoreServer vaulturl