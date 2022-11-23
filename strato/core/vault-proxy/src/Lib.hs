{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}


--This is where most of the functions exist for the vault proxy
module Lib
    ( 
    --   accessToken,
    --   expiresIn,
    --   refreshToken,
    --   notBeforePolicy,
    --   sessionState,
    --   scope,
      RawOauth(..),
      authorization_endpoint,
      token_endpoint,
      BlockAppsTokenAPI,
      InitialCallForTokenLinkAPI,
      BlockAppsTokenRequest,
      Authorization,
      ContentType,
      blockappsTokenApi,
      VaultToken(..),
    --   getVaultToken,
      getVirginToken,
    --   getAccessToken,
      connectToken,
      connectRawOauth
    ) where

-- import           Control.Concurrent.STM
import           Control.Lens
-- import           Control.Monad
-- import           Control.Monad.IO.Class
import           Data.Aeson  
import           Data.Aeson.Types
-- import           Data.Aeson.Casing  
-- import           Data.ByteString         as Bytes
-- import           Data.Cache             as Cache
-- import           Data.Int
import           Data.Proxy
import qualified Data.Scientific         as Scientific
import qualified Data.Text               as T
import           Data.Text.Encoding      as TE
-- import           Data.Time.Clock
-- import           Data.Time.Clock.System
import           GHC.Generics
-- import           HFlags
-- import           Network.HTTP.Client     hiding (Proxy)
-- import           Network.HTTP.Client.TLS
import           Network.OAuth.OAuth2    as OA  hiding (error)
-- import           Network.URI
import           Servant.API
import           Servant.Client
import           URI.ByteString          as UB
-- import           System.Clock
-- import           System.Environment


--------------------------------------------------------------------------------
--Datas
--------------------------------------------------------------------------------

-- OAuth2 flags_OAUTH_CLIENT_ID flags_OAUTH_CLIENT_SECRET getAuthorizedEndPoint getTokenEndPoint sendBackRedirect
--     where
--         getAuthorizedEndPoint = "https://keycloak.blockapps.net/auth/realms/strato-devel/protocol/openid-connect/auth" -- get from the initial poking of the discovery url
--         getTokenEndPoint = "https://keycloak.blockapps.net/auth/realms/strato-devel/protocol/openid-connect/token" --get from initial poking of the discovery url
--         sendBackRedirect = "http://localhost:8080" --Whatever port I choose for the vault-proxy to be working for (I am pretty sure)


data RawOauth = RawOauth {
    _authorization_endpoint :: T.Text,
    _token_endpoint :: T.Text --,
    -- _token_introspection_endpoint :: T.Text,
    -- _userinfo_endpoint :: T.Text,
    -- _end_session_endpoint :: T.Text,
    -- _jwks_uri :: T.Text,
    -- _check_session_iframe :: T.Text
} deriving (Show, Generic)
makeLenses ''RawOauth

instance FromJSON RawOauth where
  parseJSON (Object o) = do
    aue  <- o .: "authorization_endpoint"
    ton  <- o .: "token_endpoint"
    -- tie  <- o .: "token_introspection_endpoint"
    -- us1  <- o .: "userinfo_endpoint"
    -- ese  <- o .: "end_session_endpoint"
    -- jwk  <- o .: "jwks_uri"
    -- csi  <- o .: "check_session_iframe"
    --Ensure the correct data types are coming into the system
    authend <- case aue of
        (String s) -> pure s
        (Object _) -> error $ "Expected a JSON String under the key \"authorization_endpoint\", but got something different."
        _          -> error $ "Expected a JSON String under the key \"authorization_endpoint\", but got something different."
    tokend <- case ton of
        (String s) -> pure s
        (Object _) -> error $ "Expected a JSON String under the key \"token_endpoint\", but got something different."
        _          -> error $ "Expected a JSON String under the key \"token_endpoint\", but got something different."
    -- token_introspection_endpoint <- case tie of
    --     (String s) -> pure s
    --     (Object _) -> error $ "Expected a JSON String under the key \"token_introspection_endpoint\", but got something different."
    --     _          -> error $ "Expected a JSON String under the key \"token_introspection_endpoint\", but got something different."
    -- userinfo_endpoint <- case us1 of
    --     (String s) -> pure s
    --     (Object _) -> error $ "Expected a JSON String under the key \"userinfo_endpoint\", but got something different."
    --     _          -> error $ "Expected a JSON String under the key \"userinfo_endpoint\", but got something different."
    -- end_session_endpoint <- case ese of
    --     (String s) -> pure s
    --     (Object _) -> error $ "Expected a JSON String under the key \"end_session_endpoint\", but got something different."
    --     _          -> error $ "Expected a JSON String under the key \"end_session_endpoint\", but got something different."
    -- jwks_uri <- case jwk of
    --     (String s) -> pure s
    --     (Object _) -> error $ "Expected a JSON String under the key \"jwks_uri\", but got something different."
    --     _          -> error $ "Expected a JSON String under the key \"jwks_uri\", but got something different."
    -- --can't call it scope, so I called it scone, bon appetit
    -- check_session_iframe <- case csi of
    --     (String s) -> pure s
    --     (Object _) -> error $ "Expected a JSON String under the key \"check_session_iframe\", but got something different."
    --     _          -> error $ "Expected a JSON String under the key \"check_session_iframe\", but got something different."
--   parseJSON wat = typeMismatch "Spec" wat
    return $ RawOauth authend tokend --token_introspection_endpoint userinfo_endpoint end_session_endpoint jwks_uri check_session_iframe
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
    _scope :: T.Text
} deriving (Eq, Show, Generic)
-- makeLenses ''VaultToken

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
    scone <- case sc of
        (String s) -> pure s
        (Object _) -> error $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> error $ "Expected a JSON String under the key \"access_token\", but got something different."
    --Put the scientific numbers into regular ints
    let not_before_policy   = Scientific.coefficient notb4pol
        refresh_expires_in  = Scientific.coefficient refreshexin
        expires_in          = Scientific.coefficient exprin
--   parseJSON wat = typeMismatch "Spec" wat
    return $ VaultToken access_token expires_in refresh_expires_in refresh_token token_type not_before_policy session_state scone
  parseJSON wat = typeMismatch "Spec" wat

--------------------------------------------------------------------------------
--Types
--------------------------------------------------------------------------------
type ContentType = T.Text
type Authorization = T.Text
type BlockAppsTokenRequest = [(T.Text, T.Text)]
-- type AccessToken = (ClientM VaultToken, Int64)

type InitialCallForTokenLinkAPI =
    Get '[JSON] RawOauth

type BlockAppsTokenAPI = 
  Header "Content-Type" ContentType
  :> Header "Authorization" Authorization
  :> ReqBody '[JSON] BlockAppsTokenRequest
  :> Get '[JSON] VaultToken

getVirginToken :: T.Text -> T.Text -> RawOauth -> UB.URI --OAuth2Token ---Might need to include the discovery URL later
getVirginToken clientId clientSecret additionalOauth = authUrl --virginToken
    where 
        local_place = case (UB.parseURI UB.strictURIParserOptions $ TE.encodeUtf8 $ T.pack "http://localhost:8080") of
            Left _ -> error "Could not parse the Vault Proxy endpoint."
            Right x -> x
        authEnd = case (UB.parseURI UB.strictURIParserOptions $ TE.encodeUtf8 $ additionalOauth ^. authorization_endpoint) of 
            Left _ -> error "Could not parse the authorization endpoint, This is probably a fault of the token provider, please contact your network administration."
            Right uri -> uri
        tokenEnd = case (UB.parseURI UB.strictURIParserOptions $ TE.encodeUtf8 $ additionalOauth ^. token_endpoint) of 
            Left _ -> error "Could not parse the token endpoint, This is probably a fault of the token provider, please contact your network administration."
            Right uri -> uri
        oa = OAuth2 {
            oauthClientId = clientId,
            oauthClientSecret = Just clientSecret,
            oauthOAuthorizeEndpoint = authEnd,
            oauthAccessTokenEndpoint = tokenEnd,
            oauthCallback = Just local_place
        }
        authUrl = OA.authorizationUrl oa
        --additionalOAuthinfo = getOAuthInfo authorizationUrl

--------------------------------------------------------------------------------
--Functions
--------------------------------------------------------------------------------
rawOAuthAPI :: Proxy InitialCallForTokenLinkAPI
rawOAuthAPI = Proxy

blockappsTokenApi :: Proxy BlockAppsTokenAPI
blockappsTokenApi = Proxy

getRawOauth :: ClientM RawOauth
getRawOauth = client rawOAuthAPI

getToken :: Maybe T.Text -> Maybe T.Text -> [(T.Text, T.Text)] -> ClientM VaultToken
getToken = client blockappsTokenApi

connectRawOauth :: ClientM RawOauth
connectRawOauth = getRawOauth

connectToken :: ContentType -> Authorization -> BlockAppsTokenRequest -> ClientM VaultToken
connectToken ct a bt = getToken ct' a' bt
    where
        ct' = Just ct
        a' = Just a

-- --Gets the raw token from the OAUTH provider
-- getVirginToken :: Manager -> String -> ContentType -> Authorization -> BlockAppsTokenRequest-> (IO (Either ClientError VaultToken), Int64)
-- getVirginToken mngr tokenUrl ct tokenAuthorization extraStuff = ((Either ClientError VaultToken), Int64)
--     where
--         clientm   = connectToken ct tokenAuthorization extraStuff
--         baseUrl   = case (parseBaseUrl tokenUrl) of
--             Just url -> url
--             Nothing -> error "Invalid token url supplied 💔💔💔💔💔"
--         clientenv = mkClientEnv mngr baseUrl
--         token     = runClientM clientm clientenv -- (ClientEnv mngr (BaseUrl Https "keycloak.blockapps.net" 443 "/auth/realms/strato-devel/protocol/openid-connect/token")) 
--         time    = getCurrentTime ^. utctDayTime
--         -- time      = 



-- getVaultToken :: TVar (ClientM VaultToken, Int64) -> Manager -> BaseUrl -> ContentType -> Authorization -> BlockAppsTokenRequest -> T.Text
-- getVaultToken superToken mngr tokenUrl ct tokenAuthorization extraStuff = do
--     let goodToken    = readTVar superToken
--         token        = fst goodToken
--         timeAccessed = snd goodToken
--         currentTime  = liftIO $ getTime Monotonic
--         validityTime = token ^. expiresIn
--         validUntil   = validityTime + timeAccessed
--     --Refresh the token if it is soon to be expired 
--     if (validUntil - currentTime < 10) then 
--         swapTVar goodToken (getVirginToken mngr tokenUrl ct tokenAuthorization extraStuff)
--         pure $ getAccessToken goodToken
--         --return just the JWT token though
--     else
--         pure $ getAccessToken goodToken

-- getAccessToken :: TVar (ClientM VaultToken, Int64) -> T.Text
-- getAccessToken input = (fst $ readTVar input) ^. accessToken
------------------------------------------------------------------------------
--Getting information from the vault proxy section
------------------------------------------------------------------------------

-- https://keycloak.blockapps.net/auth/realms/strato-devel/protocol/openid-connect/token
-- -- type GuardianAPI = "search"
-- --   :> QueryParam "q" SearchTerm
-- --   :> QueryParam "api-key" ApiKey
-- --   :> Get '[JSON] GuardianResponse





--Not sure if this is the correct method to parse the JSON information
-- instance FromJSON GuardianResponse where
--   parseJSON = genericParseJSON
--     return $ GuardianResponse t

--Send this into the post body request for the servant API (this should be BlockAppsTokenRequest)
-- But it should have an hflag for the authorization code

------------------------------------------------------------------------------
--Putting information into the vault proxy section
------------------------------------------------------------------------------

-- data GuardianResponse = GuardianResponse {
--   total :: Int
--   } deriving (Eq, Show)

-- instance FromJSON GuardianResponse where
--   parseJSON = withObject "response" $ \o -> do
--     r <- o .: "response"
--     t <- r .: "total"
--     return $ GuardianResponse t

-- type SearchTerm = T.Text
-- type ApiKey = T.Text

-- type GuardianAPI = "search"
--   :> QueryParam "q" SearchTerm
--   :> QueryParam "api-key" ApiKey
--   :> Get '[JSON] GuardianResponse

-- guardianAPI :: Proxy GuardianAPI
-- guardianAPI = Proxy

-- search = client guardianAPI

-- queries :: SearchTerm -> ClientM GuardianResponse
-- queries q = do
--   t <- search (Just q) (Just "test")
--   return t

-- main :: IO ()
-- main = do
--   (x:xs) <- getArgs
--   manager' <- newManager tlsManagerSettings
--   res <- runClientM (queries (T.pack x)) (mkClientEnv manager' (BaseUrl Https "content.guardianapis.com" 443 ""))
--   print res

