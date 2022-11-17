module Strato.VaultProxy.DataTypes (
    VaultToken(..),
    accessToken,
    expiresIn,
    refreshExpiresIn,
    refreshToken,
    tokenType,
    notBeforePolicy,
    sessionState,
    sconce
) where

import           Control.Lens
import           Data.Aeson
import           Data.Aeson.Types
import           Data.Text          as T
import           Data.Scientific    as Scientific

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
} deriving (Eq, Show)

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
