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
      connectRawOauth
    ) where

import           Control.Concurrent.STM
import           Control.Lens
import           Control.Monad.Catch
import           Control.Monad.IO.Class
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
import           Servant.Client
import           System.Clock
import           Text.URI                as URI
import           Yesod.Core.Types        as YC


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

--This is the received information from the OpenId Connect response
data VaultToken = VaultToken {
    _accessToken :: T.Text,
    _expiresIn :: Integer,
    _refreshExpiresIn :: Integer,
    _refreshToken :: T.Text,
    _tokenType :: T.Text,
    _notBeforePolicy :: Integer,
    _sessionState :: T.Text,
    _scone :: T.Text
} deriving (Eq, Show, Generic)
makeLenses ''VaultToken

instance FromJSON VaultToken where
  parseJSON (Object o) = do
    ao  <- o .: "access_token"
    ei  <- o .: "expires_in"
    rei <- o .: "refresh_expires_in"
    rt  <- o .: "refresh_token"
    tt  <- o .: "token_type"
    nbp <- o .: "not-before-policy"
    ss  <- o .: "session_state"
    sc  <- o .: "scope"
    --Ensure the correct data types are coming into the system
    access_token <- case ao of
        (String s) -> pure s
        (Object _) -> error $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> error $ "Expected a JSON String under the key \"access_token\", but got something different."
    exprin <- case ei of
        (Number n) -> pure n
        (Object _) -> error $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> error $ "Expected a JSON Number under the key \"expires_in\", but got something different."
    refreshexin <- case rei of
        (Number n) -> pure n
        (Object _) -> error $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> error $ "Expected a JSON Number under the key \"refresh_expires_in\", but got something different."
    refresh_token <- case rt of
        (String s) -> pure s
        (Object _) -> error $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> error $ "Expected a JSON String under the key \"refresh_token\", but got something different."
    token_type <- case tt of
        (String s) -> pure s
        (Object _) -> error $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> error $ "Expected a JSON String under the key \"token_type\", but got something different."
    notb4pol <- case nbp of
        (Number n) -> pure n
        (Object _) -> error $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> error $ "Expected a JSON Number under the key \"not-before-policy\", but got something different."
    session_state <- case ss of
        (String s) -> pure s
        (Object _) -> error $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> error $ "Expected a JSON String under the key \"session_state\", but got something different."
    --can't call it scope, so I called it scone, bon appetit
    sconce <- case sc of
        (String s) -> pure s
        (Object _) -> error $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> error $ "Expected a JSON String under the key \"access_token\", but got something different."
    --Put the scientific numbers into regular ints
    let not_before_policy   = Scientific.coefficient notb4pol
        refresh_expires_in  = Scientific.coefficient refreshexin
        expires_in          = Scientific.coefficient exprin
--   parseJSON wat = typeMismatch "Spec" wat
    return $ VaultToken access_token expires_in refresh_expires_in refresh_token token_type not_before_policy session_state sconce
  parseJSON wat = typeMismatch "Spec" wat

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

--Need to talk to the vault now

type VaultCache = Cache T.Text VaultToken

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

-- makeJWTPayload :: VaultToken -> T.Text -> T.Text
-- makeJWTPayload token payload = "Hello World" ++ show token ++ show payload

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