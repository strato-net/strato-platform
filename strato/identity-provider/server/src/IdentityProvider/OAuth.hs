{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE OverloadedStrings #-}

-- all OAuth-related data types and functions go here
module IdentityProvider.OAuth where

import           Data.Aeson
import           Data.ByteString.Base64
import qualified Data.ByteString.UTF8 as B           (fromString)
import           Data.List                           (isSuffixOf)
import           Data.List.Split                     (splitOn)
import           Data.Map                            (Map, fromList)
import           Data.Text                           (Text)
import           GHC.Generics

import           Control.Monad.IO.Class

import           Network.HTTP.Client
import           Network.HTTP.Client.TLS
import           Network.HTTP.Types.Header           (hContentType, hAuthorization)
import           Servant.Client                      (BaseUrl, parseBaseUrl)


data ProvidedRealmInfo = -- info user provides to support realm
    ProvidedRealmInfo {
        discoveryUrl    :: String,
        clientId        :: String,
        clientSecret    :: String,
        nodeUrl         :: Maybe String,
        fallbackNodeUrl :: Maybe String
    } deriving (Show, Generic, FromJSON, ToJSON)

data OAuthEndpoints =
    OAuthEndpoints {
        issuer :: String,
        token_endpoint :: String
    } deriving (Show, Generic, ToJSON, FromJSON)

data RealmDetails =
    RealmDetails {
        realmEndpoints      :: OAuthEndpoints,
        realmClientId       :: String,
        realmClientSecret   :: String,
        associatedNodeUrl   :: BaseUrl,
        associatedFallback  :: BaseUrl
    } deriving (Show)

type RealmData = Map String RealmDetails -- realm name -> realm data

getRealmData :: MonadIO m => [ProvidedRealmInfo] -> m RealmData
getRealmData realmInfos = fromList <$> mapM parseRealmMinInfo realmInfos
    where
        parseRealmMinInfo :: MonadIO m => ProvidedRealmInfo -> m (String, RealmDetails)
        parseRealmMinInfo realmInfo = do
            endpoints <- getEndpointsFromDiscovery $ discoveryUrl realmInfo
            let realmName = extractRealmName $ issuer endpoints
            nurl <- liftIO $ parseBaseUrl $ case nodeUrl realmInfo of
                    Just url -> url
                    Nothing -> "https://node2." <> realmName <> ".blockapps.net" -- if no url provided, assume network follows this pattern
            nurl2 <- liftIO $ parseBaseUrl $ case fallbackNodeUrl realmInfo of
                    Just url -> url
                    Nothing -> "https://node1." <> realmName <> ".blockapps.net" -- node1 usually gets more traffic, so preference for node2
            return (realmName, RealmDetails {
                realmEndpoints = endpoints,
                realmClientId = clientId realmInfo,
                realmClientSecret = clientSecret realmInfo,
                associatedNodeUrl = nurl,
                associatedFallback = nurl2
            })

getEndpointsFromDiscovery :: MonadIO m => String -> m OAuthEndpoints
getEndpointsFromDiscovery url = do
    discoveryRequest <- liftIO $ parseRequest url
    manager <- liftIO $ newManager tlsManagerSettings
    response <- liftIO $ httpLbs discoveryRequest manager
    either error return (eitherDecode $ responseBody response)

extractRealmName :: String -> String
extractRealmName idProv = last $ splitOn "/" (if "/" `isSuffixOf` idProv then init idProv else idProv)



newtype AccessToken = AccessToken {access_token :: Text}
    deriving (Show, Generic, ToJSON, FromJSON)

getAccessToken :: MonadIO m => String -> String -> String -> m (Maybe AccessToken)
getAccessToken id' sec tokenEndpoint = do
    manager <- liftIO $ newManager tlsManagerSettings
    let creds64 = encodeBase64' . B.fromString $ id' <> ":" <> sec
    templateRequest <- liftIO $ parseRequest tokenEndpoint
    let rBody = RequestBodyLBS "grant_type=client_credentials"
        rHead = [(hContentType, "application/x-www-form-urlencoded"), (hAuthorization, "Basic " <> creds64)]
        request = templateRequest{requestHeaders = rHead, requestBody = rBody, method = "POST"}
    response <- liftIO $ httpLbs request manager
    return $ decode $ responseBody response



-- data OAuthUser =
--     OAuthUser {
--         id          :: Text,
--         firstName   ::  Text, --maybe
--         lastName    ::  Text, --maybe
--         attributes  :: Maybe OAuthUserAttributes
--     } deriving (Show, Generic, FromJSON, ToJSON)

-- newtype OAuthUserAttributes = OAuthUserAttributes {companyName :: Maybe [Text]}
--     deriving (Show, Generic, FromJSON, ToJSON)

-- getUserByUUID :: ( MonadIO m
--                  ) => AccessToken -> String -> String -> m (Either String OAuthUser)
-- getUserByUUID token uuid realm = do
--     manager <- liftIO $ newManager tlsManagerSettings
--     let url = "https://keycloak.blockapps.net/auth/admin/realms/" <> realm <> "/users/" <> uuid
--     templateRequest <- liftIO $ parseRequest url
--     let rHead = [(hContentType, "application/json"), (hAuthorization, encodeUtf8 $ "Bearer " <> access_token token)]
--         request = templateRequest{requestHeaders=rHead}
--     response <- liftIO $ httpLbs request manager
--     return $ eitherDecode $ responseBody response
