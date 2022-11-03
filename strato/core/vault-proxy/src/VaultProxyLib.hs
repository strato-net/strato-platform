{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}


--This is where most of the functions exist for the vault proxy
module VaultProxyLib
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

-- import           Control.Arrow
import           Control.Concurrent.STM
import           Data.Cache
import           Control.Lens
-- import           Control.Monad
import           Control.Monad.Except
-- import           Control.Monad.IO.Class
import           Data.Aeson  
import           Data.Aeson.Types
-- import           Data.Aeson.Casing  
-- import           Data.ByteString         as BS
import           Data.Cache             as Cache
-- import           Data.Int
import           Data.Proxy
import qualified Data.Scientific         as Scientific
import qualified Data.Text               as T
import           Data.Text.Encoding      as TE
-- import           Data.Time.Clock
-- import           Data.Time.Clock.System
import           GHC.Generics
-- import           HFlags
import           Network.HTTP.Client     hiding (Proxy)
-- import           Network.HTTP.Client.TLS
import           Network.OAuth.OAuth2    as OA  hiding (error)
-- import           Network.OAuth.OAuth2.Internal as OAI hiding (error)
-- import           Network.URI
import           Servant.API
import           Servant.Client
import           URI.ByteString          as UB
import           Data.ByteString.Base64
-- import           System.Clock
-- import           System.Environment


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

--This will get a fresh brand new, minty fresh clean token from the OAuth provider,
--User never really needs to use this function, it is mostly called by getAwesomeToken 
getVirginToken :: MonadIO m => Manager -> T.Text -> T.Text -> RawOauth -> m OAuth2Token --OAuth2Token ---Might need to include the discovery URL later
getVirginToken manny clientId clientSecret additionalOauth = do --virginToken

    let authEnd = case (UB.parseURI UB.strictURIParserOptions $ TE.encodeUtf8 $ additionalOauth ^. authorization_endpoint) of 
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
            oauthCallback = Nothing
        }
        exchangeToken = ExchangeToken $ T.concat [T.pack "Basic ", encodeBase64 $ TE.encodeUtf8 $ T.concat [clientId, ":", clientSecret]]
    super <- runExceptT $ liftIO $ OA.fetchAccessToken manny oa exchangeToken
    --13
    attttttttttttt <- case super of 
            Left _ -> error "Had some difficulty connecting to the OAuth Provider, it is likely a network problem."
            Right tok -> case tok of
                Left err -> error ("Had some difficulty connecting to the OAuth Provider, likely administative." ++ show err)
                Right toks -> pure toks
    pure attttttttttttt

--This will get the correct token and will get a cached token if it is still valid
getAwesomeToken :: MonadIO STM m => Maybe STM (Cache k (OAuth2Token)) -> Manager -> T.Text -> T.Text -> RawOauth -> m OAuth2Token
getAwesomeToken oldToken manny clientId clientSecret additionalOauth = do
    --Make a new token if needed TODO: Fix the types, ensure both are of the STM variety
    --Used to initilize the token if needed
    newToken <- case oldToken of 
        Nothing <- getVirginToken manny clientId clientSecret additionalOauth
        Just o <- o
    --Get the token from the cache
    token <- readTVar oldToken
    --Retrieve the token if it is still valid, eagerly destroy if it is not valid
    otoken <- lookupSTM True clientId token (getTime Monotonic)
    finalToken <- case otoken of 
        --return the token if it is still valid
        Just tok -> pure tok
        --Make a token and 
        Nothing -> do 
            --Get a new token from OAuth provider
            newToken <- getVirginToken manny clientId clientSecret additionalOauth
            --Set the expry time to the current time + the expry time from the OAuth provider,
            --then minus 10 seconds to ensure freshness of the token
            expry <- fromNanoSecs (TimeSpec(getTime) + (newToken ^. expiresIn - 10) * 1000000000)
            --Insert the fresh token into the cache with the set expriration time
            Cache.insertSTM clientId newToken (Cache clientId newToken) (Just expry)
            --Return the new Token, the item in cache can be referenced else where.
            pure newToken

    pure finalToken
    --Check if the token is still valid
    -- validToken <- case token of
    --     Nothing -> pure False
    --     Just tok -> do
    --         let expTime = tok ^. OA.tokenExpiresIn
    --         currentTime <- liftIO $ getCurrentTime
    --         pure $ expTime > currentTime
    -- pure validToken 
    --If the token is not valid, get a new one


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