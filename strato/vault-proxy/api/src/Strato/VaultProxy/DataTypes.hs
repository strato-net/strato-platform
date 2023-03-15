{-# LANGUAGE DeriveGeneric #-}

module Strato.VaultProxy.DataTypes (
    VaultToken(..),
    VaultConnection(..),
    RawOauth(..),
    Version(..)
) where

import           Control.Concurrent.MVar
import           Data.Aeson
import           Data.Aeson.Types
import qualified Data.Aeson.Key as DAK
import           Data.List          as Dl
import           Data.Text          as T
import           Data.Scientific    as Scientific
import           Network.HTTP.Client
import           GHC.Generics

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
    ao  <- o .: DAK.fromString "access_token"
    ei  <- o .: DAK.fromString "expires_in"
    rei <- o .: DAK.fromString "refresh_expires_in"
    rt  <- o .: DAK.fromString "refresh_token"
    tt  <- o .: DAK.fromString "token_type"
    nbp <- o .: DAK.fromString "not-before-policy"
    ss  <- o .: DAK.fromString "session_state"
    sc  <- o .: DAK.fromString "scope"
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
  parseJSON wat = typeMismatch "VaultToken " wat

--TODO: use lenses (not important but would be nice)
data VaultConnection = VaultConnection {
    vaultUrl :: T.Text,
    httpManager :: Manager,
    oauthUrl :: T.Text,
    oauthClientId :: T.Text,
    oauthClientSecret :: T.Text,
    oauthReserveSeconds :: Int,
    vaultProxyUrl :: T.Text,
    vaultProxyPort :: Int,
    -- tokenCache :: Cache T.Text VaultToken,
    tokenMVar :: MVar VaultToken,
    additionalOauth :: RawOauth,
    -- superLock :: L.Lock,
    debuggingOn :: Bool
}

data RawOauth = RawOauth {
    authorization_endpoint :: T.Text,
    token_endpoint :: T.Text --,
} deriving (Show, Eq)

instance FromJSON RawOauth where
  parseJSON (Object o) = do
    aue  <- o .: DAK.fromString "authorization_endpoint"
    ton  <- o .: DAK.fromString "token_endpoint"

    authend <- case aue of
        (String s) -> pure s
        (Object _) -> error $ "Expected a JSON String under the key \"authorization_endpoint\", but got something different."
        _          -> error $ "Expected a JSON String under the key \"authorization_endpoint\", but got something different."
    tokend <- case ton of
        (String s) -> pure s
        (Object _) -> error $ "Expected a JSON String under the key \"token_endpoint\", but got something different."
        _          -> error $ "Expected a JSON String under the key \"token_endpoint\", but got something different."
    return $ RawOauth authend tokend 
  parseJSON wat = typeMismatch "RawOauth " wat

data Version = Version {
    version :: Int
} deriving (Show, Eq, Generic)

instance ToJSON Version where
  toJSON = genericToJSON defaultOptions

instance FromJSON Version where
  parseJSON (Object o) = do
    ver  <- o .: DAK.fromString "version"

    vers <- case ver of
        (Number ver1) -> do 
            ver2 <- if isInteger ver1 then 
                case toBoundedInteger ver1 of 
                    Nothing -> error "The Integer returned by the server was outside of expect/normal bounds. Will stop talking to server to prevent system crash."
                    Just i -> pure (fromIntegral (i :: Int))
            else 
                error $ "Expected an Integer for the version number, got a float instead"
            pure ver2
        (Object _) -> error $ "Expected a JSON Number under the key \"version\", but got something different."
        _          -> error $ "Expected a JSON Number under the key \"version\", but got something different."
    
    return $ Version vers
  --TODO remove this after shared-vault gets updated 
  parseJSON (String o) = if Dl.isInfixOf "pingDetail"  (T.unpack o) --NOTE THIS SHOULD be removed and is just a hack to get the user-x and builder-x node working.
    then  return $ Version 0 -- Remove this once vault version is 
    else  typeMismatch "Version" (String o)
  parseJSON wat = typeMismatch "Version " wat
