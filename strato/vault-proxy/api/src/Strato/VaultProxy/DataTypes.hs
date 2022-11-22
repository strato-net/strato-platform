module Strato.VaultProxy.DataTypes (
    VaultToken(..),
    VaultConnection(..),
    RawOauth(..)
    -- accessToken,
    -- expiresIn,
    -- refreshExpiresIn,
    -- refreshToken,
    -- tokenType,
    -- notBeforePolicy,
    -- sessionState,
    -- sconce
) where

-- import           Control.Lens
import           Data.Aeson
import           Data.Aeson.Types
import           Data.Cache
import           Data.Text          as T
import           Data.Scientific    as Scientific
import           Network.HTTP.Client

--This is the received information from the OpenId Connect response
data VaultToken = VaultToken {
    accessToken :: T.Text,
    expiresIn :: Integer,
    refreshExpiresIn :: Integer,
    refreshToken :: T.Text,
    tokenType :: T.Text,
    notBeforePolicy :: Integer,
    sessionState :: T.Text,
    scone :: T.Text
} deriving (Eq, Show)
-- makeLenses ''VaultToken

instance FromJSON VaultToken where
  parseJSON (Object o) = do
    ao  <- o .: T.pack "access_token"
    ei  <- o .: T.pack "expires_in"
    rei <- o .: T.pack "refresh_expires_in"
    rt  <- o .: T.pack "refresh_token"
    tt  <- o .: T.pack "token_type"
    nbp <- o .: T.pack "not-before-policy"
    ss  <- o .: T.pack "session_state"
    sc  <- o .: T.pack "scope"
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

--TODO: use lenses (not important but would be nice)
data VaultConnection = VaultConnection {
    vaultUrl :: T.Text,
    vaultPassword :: T.Text,
    vaultPort :: Int,
    manger :: Manager, --Please don't export this, not useful to the user (unless we put this not in its own executable, but then we shouldn't have this)
    oauthEnabled :: Bool,
    oauthUrl :: T.Text,
    oauthClientId :: T.Text,
    oauthClientSecret :: T.Text,
    oauthReserveSeconds :: Int,
    oauthServiceClientId :: T.Text,
    oauthServiceClientSecret :: T.Text,
    vaultProxyUrl :: T.Text,
    vaultProxyPort :: Int,
    tokenCache :: Cache T.Text VaultToken,
    additionalOauth :: RawOauth
}

data RawOauth = RawOauth {
    authorization_endpoint :: T.Text,
    token_endpoint :: T.Text --,
} deriving (Show, Eq)

instance FromJSON RawOauth where
  parseJSON (Object o) = do
    aue  <- o .: T.pack "authorization_endpoint"
    ton  <- o .: T.pack "token_endpoint"

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