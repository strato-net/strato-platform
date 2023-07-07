{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}

module Lib 
    ( AccessToken
    , getAccessToken
    , OAuthUser
    , identityProviderApp
    , getUserByUUID
    )
where

import           Servant
import           Network.HTTP.Client hiding (Proxy)
import           Network.HTTP.Types.Header (hContentType, hAuthorization)

import           Data.Aeson
-- import           Data.Map
import           Data.Text (Text, unpack)
import           Data.Text.Encoding (encodeUtf8)
import           GHC.Generics
import           Blockchain.Strato.Model.Address (Address(..))

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



type PutIdentity = "identity" -- what headers to include? -> shouwl be X-ACCESS-USER-TOKEN
                :> Header' '[Required, Strict] "Authorization" Text -- parse this as JWT -> get 'sub' field for user's uuid
                :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
                :> Header' '[Required, Strict] "X-IDENTITY-PROVIDER" Text
                :> Put '[JSON] Address --should return cert address
--realm name should be parameter
--root cert just files on server's file system (flag to point to files)
--ask Zach where storing org name and common name on keycloak (attribute?)
--use makeSignedCert function (or refactor the x509-gen tool)
--add client binding to tx endpoint (then call it)
--node url should also be a param
type IdentityProviderAPI = PutIdentity --only 1 endpoint

-- use vault client bindings
makeCert :: Text -> Text -> Handler Address
makeCert _ _ = do
    -- first check if a user exists in vault
    return $ Address 0x509

identityProviderServer :: Server IdentityProviderAPI
identityProviderServer = putIdentity

identityProviderApp :: Application
identityProviderApp = serve (Proxy @IdentityProviderAPI) identityProviderServer
