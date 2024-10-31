{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

-- all OAuth-related data types and functions go here
module IdentityProvider.OAuth where

import Blockchain.Strato.Model.Address (Address(..))
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import Control.Monad.IO.Class
import Data.Aeson
import Data.ByteString.Base64
import qualified Data.ByteString.UTF8 as B (fromString)
import Data.Cache.LRU hiding (fromList)
import Data.IORef
import Data.List (isSuffixOf)
import Data.List.Split (splitOn)
import Data.Map (Map, fromList)
import Data.Maybe (fromMaybe)
import Data.Text (Text)
import Data.Time.Clock (UTCTime, getCurrentTime)
import GHC.Generics
import Network.HTTP.Client
import Network.HTTP.Client.TLS
import Network.HTTP.Types.Header (hAuthorization, hContentType)
import Servant.Client (BaseUrl, parseBaseUrl)

data ProvidedRealmInfo -- info user provides to support realm
  = ProvidedRealmInfo
  { discoveryUrl :: String,
    clientId :: String,
    clientSecret :: String,
    nodeUrl :: Maybe String,
    fallbackNodeUrl :: Maybe String,
    userRegistryAddress :: Maybe Address,
    userRegistryCodeHash :: Maybe Keccak256,
    userTableName :: Maybe String,
    notificationServerUrl :: Maybe String
  }
  deriving (Show, Generic, FromJSON, ToJSON)

data OAuthEndpoints = OAuthEndpoints
  { issuer :: String,
    token_endpoint :: String
  }
  deriving (Show, Generic, ToJSON, FromJSON)

data RealmDetails = RealmDetails
  { realmEndpoints :: OAuthEndpoints,
    realmClientId :: String,
    realmClientSecret :: String,
    associatedNodeUrl :: BaseUrl,
    associatedFallback :: BaseUrl,
    realmUserRegAddr :: Address,
    realmUserRegCodeHash :: Maybe Keccak256,
    realmUserTableName :: String,
    realmNoficicationServerUrl :: Maybe String,
    cacheRef :: IORef (LRU String Address), -- commonName -> userAddress
    accessTokenRef :: IORef (Maybe AccessToken, UTCTime)
  }

type RealmMap = Map String RealmDetails -- realm name -> realm dets

getRealmMap :: MonadIO m => [ProvidedRealmInfo] -> Int -> m RealmMap
getRealmMap realmInfos cacheSize = fromList <$> mapM parseRealmMinInfo realmInfos
  where
    parseRealmMinInfo :: MonadIO m => ProvidedRealmInfo -> m (String, RealmDetails)
    parseRealmMinInfo realmInfo = do
      endpoints <- getEndpointsFromDiscovery $ discoveryUrl realmInfo
      let realmName = extractRealmName $ issuer endpoints
      nurl <- liftIO $
        parseBaseUrl $ case nodeUrl realmInfo of
          Just url -> url
          Nothing -> "https://node2." <> realmName <> ".blockapps.net" -- if no url provided, assume network follows this pattern
      nurl2 <- liftIO $
        parseBaseUrl $ case fallbackNodeUrl realmInfo of
          Just url -> url
          Nothing -> "https://node1." <> realmName <> ".blockapps.net" -- node1 usually gets more traffic, so preference for node2
      cRef <- liftIO $ newIORef $ newLRU (Just $ toInteger cacheSize)
      now <- liftIO getCurrentTime
      tRef <- liftIO $ newIORef (Nothing, now)
      return
        ( realmName,
          RealmDetails
            { realmEndpoints = endpoints,
              realmClientId = clientId realmInfo,
              realmClientSecret = clientSecret realmInfo,
              associatedNodeUrl = nurl,
              associatedFallback = nurl2,
              realmUserRegAddr = fromMaybe (Address 0x720) $ userRegistryAddress realmInfo,
              realmUserRegCodeHash = userRegistryCodeHash realmInfo,
              realmUserTableName = fromMaybe "User" $ userTableName realmInfo,
              realmNoficicationServerUrl = notificationServerUrl realmInfo, 
              cacheRef = cRef,
              accessTokenRef = tRef
            }
        )

getEndpointsFromDiscovery :: MonadIO m => String -> m OAuthEndpoints
getEndpointsFromDiscovery url = do
  discoveryRequest <- liftIO $ parseRequest url
  manager <- liftIO $ newManager tlsManagerSettings
  response <- liftIO $ httpLbs discoveryRequest manager
  either error return (eitherDecode $ responseBody response)

extractRealmName :: String -> String
extractRealmName idProv = last $ splitOn "/" (if "/" `isSuffixOf` idProv then init idProv else idProv)

data AccessToken = AccessToken
  { access_token :: Text,
    expires_in :: Integer
  }
  deriving (Show, Generic, ToJSON, FromJSON)

getAccessToken :: MonadIO m => String -> String -> String -> m (Maybe AccessToken)
getAccessToken id' sec tokenEndpoint = do
  manager <- liftIO $ newManager tlsManagerSettings
  let creds64 = encodeBase64' . B.fromString $ id' <> ":" <> sec
  templateRequest <- liftIO $ parseRequest tokenEndpoint
  let rBody = RequestBodyLBS "grant_type=client_credentials"
      rHead = [(hContentType, "application/x-www-form-urlencoded"), (hAuthorization, "Basic " <> creds64)]
      request = templateRequest {requestHeaders = rHead, requestBody = rBody, method = "POST"}
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
