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
      BlockAppsTokenAPI,
      BlockAppsTokenRequest,
      Authorization,
      ContentType,
      blockappsTokenApi,
      VaultToken(..),
    --   getVaultToken,
    --   getVirginToken,
    --   getAccessToken,
      connectToken
    ) where

-- import           Control.Concurrent.STM
-- import           Control.Lens
-- import           Control.Monad
-- import           Control.Monad.IO.Class
import           Data.Aeson  
import           Data.Aeson.Types
-- import           Data.Aeson.Casing  
-- import           Data.ByteString     
-- import           Data.Cache             as Cache
-- import           Data.Int
import           Data.Proxy
import qualified Data.Scientific         as Scientific
import qualified Data.Text               as T
-- import           Data.Time.Clock
-- import           Data.Time.Clock.System
import           GHC.Generics
-- import           HFlags
-- import           Network.HTTP.Client     hiding (Proxy)
-- import           Network.HTTP.Client.TLS
import           Servant.API
import           Servant.Client
-- import           System.Clock
-- import           System.Environment


--------------------------------------------------------------------------------
--Datas
--------------------------------------------------------------------------------

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
        (Object _) -> fail $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> fail $ "Expected a JSON String under the key \"access_token\", but got something different."
    exprin <- case ei of
        (Number n) -> pure n
        (Object _) -> fail $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> fail $ "Expected a JSON Number under the key \"expires_in\", but got something different."
    refreshexin <- case rei of
        (Number n) -> pure n
        (Object _) -> fail $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> fail $ "Expected a JSON Number under the key \"refresh_expires_in\", but got something different."
    refresh_token <- case rt of
        (String s) -> pure s
        (Object _) -> fail $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> fail $ "Expected a JSON String under the key \"refresh_token\", but got something different."
    token_type <- case tt of
        (String s) -> pure s
        (Object _) -> fail $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> fail $ "Expected a JSON String under the key \"token_type\", but got something different."
    notb4pol <- case nbp of
        (Number n) -> pure n
        (Object _) -> fail $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> fail $ "Expected a JSON Number under the key \"not-before-policy\", but got something different."
    session_state <- case ss of
        (String s) -> pure s
        (Object _) -> fail $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> fail $ "Expected a JSON String under the key \"session_state\", but got something different."
    --can't call it scope, so I called it scone, bon appetit
    scone <- case sc of
        (String s) -> pure s
        (Object _) -> fail $ "Expected a JSON String under the key \"access_token\", but got something different."
        _          -> error $ "Expected a JSON String under the key \"scope\", but got something different."
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

type BlockAppsTokenAPI = 
  Header "Content-Type" ContentType
  :> Header "Authorization" Authorization
  :> ReqBody '[JSON] BlockAppsTokenRequest
  :> Post '[JSON] VaultToken

--------------------------------------------------------------------------------
--Functions
--------------------------------------------------------------------------------
blockappsTokenApi :: Proxy BlockAppsTokenAPI
blockappsTokenApi = Proxy

getToken :: Maybe T.Text -> Maybe T.Text -> [(T.Text, T.Text)] -> ClientM VaultToken
getToken = client blockappsTokenApi

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

