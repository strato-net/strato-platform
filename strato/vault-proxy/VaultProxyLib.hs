-- {-# LANGUAGE FlexibleContexts  #-}
-- {-# LANGUAGE ConstraintKinds   #-}
{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}


module VaultProxyLib
    ( 
      accessToken,
      expiresIn,
      refreshExpiresIn,
      refreshToken,
      tokenType,
      notBeforePolicy,
      sessionState,
      scone,
      RawOauth(..),
      authorization_endpoint,
      token_endpoint,
      BlockAppsTokenAPI,
      InitialCallForTokenLinkAPI,
      BlockAppsTokenRequest,
      Authorization,
      ContentType,
      blockappsTokenApi,
      VaultCache,
      VaultToken(..),
      getVirginToken,
      getAwesomeToken,
      connectRawOauth,
    --   checkIfAlive,
      VaultConnection(..),
      vaultUrl,
      vaultPassword,
      vaultPort,
      vaulty
    ) where

import           Control.Concurrent.STM
import           Control.Lens
import           Control.Monad.Catch
-- import           Control.Monad.Composable.VaultProxy
import           Control.Monad.IO.Class
import           Control.Monad.Reader
import           Control.Monad.Change.Modify
import           Data.Aeson  
import           Data.Aeson.Types
import           Data.ByteString.Base64
import           Data.Cache               as C
import           Data.Cache.Internal      as C
import           Data.Maybe
import           Data.Proxy
import qualified Data.Scientific         as Scientific
import qualified Data.Text               as T
import           Data.Text.Encoding      as TE
import           GHC.Generics
import           Network.HTTP.Client     as HTC hiding (Proxy)
import           Network.HTTP.Req        as R
import           Servant.API             as SA
import           Servant.Auth            as SAA
import           Servant.Auth.Server     as SAS
import           Servant.Client
import           Servant.Server          as SS
import           System.Clock
import           Text.URI                as URI
import           Yesod.Core.Types        as YC

--matching types import (reduce redundant changes)
import           Blockchain.Strato.Model.Address
import           Strato.VaultProxy.API.Types as Types--Likely will make a circular dependency
import           Blockchain.Strato.Model.Secp256k1
import           Strato.VaultProxy.API.Users
import           Strato.VaultProxy.API.Key
import           Strato.VaultProxy.API.Signature
import           Strato.VaultProxy.API.Password
import           Strato.VaultProxy.API.Ping

--------------------------------------------------------------------------------
--Datas
--------------------------------------------------------------------------------

data RawOauth = RawOauth {
    _authorization_endpoint :: T.Text,
    _token_endpoint :: T.Text --,
} deriving (Show, Generic, Eq)
makeLenses ''RawOauth

instance FromJSON RawOauth where
  parseJSON (Object o) = do
    aue  <- o .: "authorization_endpoint"
    ton  <- o .: "token_endpoint"

    authend <- case aue of
        (String s) -> pure s
        (Object _) -> error $ "Expected a JSON String under the key \"authorization_endpoint\", but got something different."
        _          -> error $ "Expected a JSON String under the key \"authorization_endpoint\", but got something different."
    tokend <- case ton of
        (String s) -> pure s
        (Object _) -> error $ "Expected a JSON String under the key \"token_endpoint\", but got something different."
        _          -> error $ "Expected a JSON String under the key \"token_endpoint\", but got something different."
    return $ RawOauth authend tokend 
  parseJSON wat = typeMismatch "Spec" wat

-- instance FromJSON AddressAndKey where
--   parseJSON (Object o) = do 
--     a <- o .: "address"
--     k <- o .: "pubkey"
--     return $ AddressAndKey a k 
--   parseJSON o = error $ "parseJSON AddressAndKey: expected object, but got " ++ show o


data VaultConnection = VaultConnection {
    _vaultUrl :: T.Text,
    _httpManager :: Manager, --Please don't export this, not useful to the user (unless we put this not in its own executable, but then we shouldn't have this)
    _oauthUrl :: T.Text,
    _oauthClientId :: T.Text,
    _oauthClientSecret :: T.Text,
    _oauthReserveSeconds :: Int,
    _vaultProxyUrl :: T.Text,
    _vaultProxyPort :: Int
}
makeLenses ''VaultConnection

--------------------------------------------------------------------------------
--Types
--------------------------------------------------------------------------------
type ContentType' = T.Text
type Authorization = T.Text
type BlockAppsTokenRequest = [(T.Text, T.Text)]
-- type AccessToken = (ClientM VaultToken, Int64)

type InitialCallForTokenLinkAPI =
    Get '[SA.JSON] RawOauth

type BlockAppsTokenAPI = 
  SA.Header "Content-Type" ContentType'
  :> SA.Header "Authorization" Authorization
  :> ReqBody '[SA.JSON] BlockAppsTokenRequest
  :> Get '[SA.JSON] VaultToken

type VaultCache = Cache T.Text VaultToken

type VaultProxyAPI = Auth '[SAA.JWT, SAA.BasicAuth] Types.User :> "vault-proxy" :> VaultAPI

--Need to talk to the vault now
-- TODO: Make this work, and get rid of the multiple "vault-proxy" instances
type VaultAPI = GetPing
           :<|> GetKey
           :<|> PostKey
           :<|> GetSharedKey
           :<|> GetUsers
           :<|> PostSignature
           :<|> PostPassword
           :<|> VerifyPassword

type VaultM = ReaderT VaultProxyEnv (LoggingT IO)

--TODO: remove this if it is not needed (likely removable and replaced with VaultConnection)
data VaultProxyEnv = VaultProxyEnv
  { httpManager         :: Manager
  , dbPool              :: Pool Connection
  , superSecretKey      :: IORef (Maybe SecretBox.Key)
  , keyStoreCache       :: Cache Text KeyStore
  }

--------------------------------------------------------------------------------
--API Endpoints (these are used to connect TO the Vault-Proxy)
--------------------------------------------------------------------------------

--------------------------------------------------------------------------------
--API "proxypoints" (these are used to make the proxy calls to the shared vault)
--------------------------------------------------------------------------------

--------------------------------------------------------------------------------
--Functions
--------------------------------------------------------------------------------

--This will get a fresh brand new, minty fresh clean token from the OAuth provider,
--User never really needs to use this function, it is mostly called by getAwesomeToken 
getVirginToken ::  (MonadIO m, MonadThrow m) => T.Text -> T.Text -> RawOauth -> m VaultToken --OAuth2Token ---Might need to include the discovery URL later
getVirginToken clientId clientSecret additionalOauth = do --virginToken
    --Conver the token endpoint to a URI
    uri <- URI.mkURI $ additionalOauth ^. token_endpoint
    --Encode all of the parameters, get ready to send to server
    let (url, _) = fromJust (useHttpsURI $ uri)
        authHeadr = header "Authorization" $ TE.encodeUtf8 $ T.concat [T.pack "Basic ", encodeBase64 $ TE.encodeUtf8 $ T.concat [clientId, ":", clientSecret]]
        contType = header "Content-Type" $ TE.encodeUtf8 $ T.pack "application/x-www-form-urlencoded"
        urlEncodedPart = ReqBodyUrlEnc $ "grant_type" =: ("client_credentials" :: String)
    --Connect to the server
    makeHttpCall <- runReq defaultHttpConfig $ do
        response <- R.req R.POST url urlEncodedPart (jsonResponse) (authHeadr <> contType )
        pure response
    --Convert the server response to the VaultToken type
    pure $ HTC.responseBody $ toVanillaResponse makeHttpCall

--This will get the correct token and will get a cached token if it is still valid
getAwesomeToken :: (MonadIO m, MonadThrow m) => VaultCache -> T.Text -> T.Text -> Int -> RawOauth -> m VaultToken
getAwesomeToken squirrel clientId clientSecret reserveTime additionalOauth = do
    --Get the current STM time and the check if the item in memory needs to be cleared, clear it if needed
    cache <- liftIO . atomically $ do 
        now <- C.nowSTM
        cash <- lookupSTM True clientId squirrel now
        pure cash

    --If the cache is up to date, then just return the VaultToken
    vaultToken <- case cache of 
        Just c -> pure c
        --If the token was old destroy the old token and get a new one
        Nothing -> do 
            -- Get the virgin token from the provider
            let vToken = getVirginToken clientId clientSecret additionalOauth
            virToken <- vToken
            --Calculate the time that the token will expire
            exTime <- makeExpry virToken reserveTime
            --Insert the new token into the STM cache
            liftIO . atomically $ insertSTM clientId virToken squirrel (Just exTime)
            pure virToken
    pure vaultToken

--This is the standard expry time for the token, it is 13 seconds less than the expry time from the OAuth provider
makeExpry :: MonadIO m => VaultToken -> Int -> m TimeSpec 
--Make the expry negative if the token does not have the expiresIn field set, this will force a new token to be made always
    --Not sure if this will really occur, but it is a good safety net 🕸️
makeExpry token reserveTime = do 
    whatTimeIsIt <- liftIO $ getTime Monotonic
    let nanoTime :: Integer
        nanoTime = toNanoSecs (whatTimeIsIt)
        tokenExpry :: Integer
        tokenExpry =  token ^. expiresIn
        expry :: TimeSpec
        expry = fromNanoSecs ( nanoTime + (tokenExpry - toInteger reserveTime) * 1000000000)
    pure expry

getKey :: Manager -> VaultConnection -> VaultCache -> T.Text -> Maybe T.Text -> VaultProxyM AddressAndKey
--Bounce the information from the vaultproxy to the shared vault, allow for the use of the caching service implmented earlier in the vaultProxy
getKey boss env squirrel userName otherPub = do 
    -- jwtToken <- (liftIO $ getAwesomeToken squirrel (foreign ^. clientId) (foreign ^. clientSecret) (foreign ^. reserveTime) (foreign ^. additionalOauth)) ^. accessToken
    --use res to send the data to vault, adding token to the front header
    pure undefined

postKey :: T.Text -> VaultProxyM AddressAndKey
--Bounce the information from the vaultproxy to the shared vault, allow for the use of the caching service implmented earlier in the vaultProxy
postKey kii = pure undefined

getSharedKey :: T.Text -> PublicKey -> VaultProxyM SharedKey
--Bounce the information from the vaultproxy to the shared vault, allow for the use of the caching service implmented earlier in the vaultProxy
getSharedKey kii pubKii = pure undefined

postPassword :: T.Text -> VaultProxyM ()
--Bounce the information from the vaultproxy to the shared vault, allow for the use of the caching service implmented earlier in the vaultProxy
postPassword pass = pure undefined

verifyPassword :: VaultProxyM Bool
--Bounce the information from the vaultproxy to the shared vault, allow for the use of the caching service implmented earlier in the vaultProxy
verifyPassword = pure undefined

-- getPing :: VaultProxyM String --Only used in the vault, but could be useful in doing an initial health check
--Bounce the information from the vaultproxy to the shared vault, allow for the use of the caching service implmented earlier in the vaultProxy


postSignature :: T.Text -> MsgHash -> VaultProxyM Types.Signature
--Bounce the information from the vaultproxy to the shared vault, allow for the use of the caching service implmented earlier in the vaultProxy
postSignature sig hash = pure undefined

getUsers :: T.Text -> Maybe Address -> Maybe Int -> Maybe Int -> VaultProxyM [Types.User]
--Bounce the information from the vaultproxy to the shared vault, allow for the use of the caching service implmented earlier in the vaultProxy
getUsers temp temp1 temp2 temp3 = pure undefined

--This is the actualy function that the services will connect to the vaultProxy with
vaultProxyServer :: SS.Server VaultAPI
vaultProxyServer = getKey
    :<|> getPing
    :<|> postKey
    :<|> getSharedKey
    :<|> getUsers
    :<|> postSignature
    :<|> postPassword
    :<|> verifyPassword

runVaultProxyM :: MonadIO m => String -> VaultProxyM m a -> m a --Might want to add this to the central monad directory strato/libs/composable-monads/vault-monad (this will need to be a new executable though 🤦)
runVaultProxyM url = do
    manager <- liftIO $ newManager defaultManagerSettings
    vaultProxyUrl <- liftIO $ parseBaseUrl url
    runReaderT f $ VaultConnection vaultProxyUrl flags_VAULT_PASSWORD flags_VAULT_PORT manager

-- makeJWTPayload :: VaultToken -> T.Text -> T.Text
-- makeJWTPayload token payload = "Hello World" ++ show token ++ show payload
-- checkIfAlive :: VaultToken -> Bool
-- checkIfAlive token = do
--     let expry = token ^. expiresIn
--     if expry > 0 then True else False

--------------------------------------------------------------------------------
--API functions
--------------------------------------------------------------------------------
rawOAuthAPI :: Proxy InitialCallForTokenLinkAPI
rawOAuthAPI = Proxy

blockappsTokenApi :: Proxy BlockAppsTokenAPI
blockappsTokenApi = Proxy

getRawOauth :: ClientM RawOauth
getRawOauth = client rawOAuthAPI

connectRawOauth :: ClientM RawOauth
connectRawOauth = getRawOauth
