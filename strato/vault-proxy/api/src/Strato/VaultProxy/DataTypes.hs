{-# LANGUAGE DeriveGeneric #-}

module Strato.VaultProxy.DataTypes
  ( VaultToken (..),
    VaultConnection (..),
    RawOauth (..),
    Version (..),
  )
where

-- import           Control.Lens
import Control.Concurrent.Lock as L
import Data.Aeson
import qualified Data.Aeson.Key as DAK
import Data.Aeson.Types
import Data.Cache
import Data.List as Dl
import Data.Scientific as Scientific
import Data.Text as T
import GHC.Generics
import Network.HTTP.Client

--This is the received information from the OpenId Connect response
data VaultToken = VaultToken
  { accessToken :: T.Text,
    expiresIn :: Integer
  }
  deriving (Eq, Show)

-- makeLenses ''VaultToken

instance FromJSON VaultToken where
  parseJSON (Object o) = do
    ao <- o .: DAK.fromString "access_token"
    ei <- o .: DAK.fromString "expires_in"
    --Ensure the correct data types are coming into the system
    access_token <- case ao of
      (String s) -> pure s
      _ -> fail $ "Expected a JSON String under the key \"access_token\", but got something different."
    exprin <- case ei of
      (Number n) -> pure n
      _ -> fail $ "Expected a JSON String under the key \"access_token\", but got something different."
    let expires_in = Scientific.coefficient exprin
    return $ VaultToken access_token expires_in
  parseJSON wat = fail $ "FromJSON VaultToken: Expected Object, got " ++ show wat

--TODO: use lenses (not important but would be nice)
data VaultConnection = VaultConnection
  { vaultUrl :: T.Text,
    httpManager :: Manager,
    oauthUrl :: T.Text,
    oauthClientId :: T.Text,
    oauthClientSecret :: T.Text,
    oauthReserveSeconds :: Int,
    vaultProxyUrl :: T.Text,
    vaultProxyPort :: Int,
    tokenCache :: Cache T.Text VaultToken,
    additionalOauth :: RawOauth,
    superLock :: L.Lock,
    debuggingOn :: Bool
  }

data RawOauth = RawOauth
  { authorization_endpoint :: T.Text,
    token_endpoint :: T.Text --,
  }
  deriving (Show, Eq)

instance FromJSON RawOauth where
  parseJSON (Object o) = do
    aue <- o .: DAK.fromString "authorization_endpoint"
    ton <- o .: DAK.fromString "token_endpoint"

    authend <- case aue of
      (String s) -> pure s
      (Object _) -> error $ "Expected a JSON String under the key \"authorization_endpoint\", but got something different."
      _ -> error $ "Expected a JSON String under the key \"authorization_endpoint\", but got something different."
    tokend <- case ton of
      (String s) -> pure s
      (Object _) -> error $ "Expected a JSON String under the key \"token_endpoint\", but got something different."
      _ -> error $ "Expected a JSON String under the key \"token_endpoint\", but got something different."
    return $ RawOauth authend tokend
  parseJSON wat = typeMismatch "RawOauth " wat

data Version = Version
  { version :: Int
  }
  deriving (Show, Eq, Generic)

instance ToJSON Version where
  toJSON = genericToJSON defaultOptions

instance FromJSON Version where
  parseJSON (Object o) = do
    ver <- o .: DAK.fromString "version"

    vers <- case ver of
      (Number ver1) -> do
        ver2 <-
          if isInteger ver1
            then case toBoundedInteger ver1 of
              Nothing -> error "The Integer returned by the server was outside of expect/normal bounds. Will stop talking to server to prevent system crash."
              Just i -> pure (fromIntegral (i :: Int))
            else error $ "Expected an Integer for the version number, got a float instead"
        pure ver2
      (Object _) -> error $ "Expected a JSON Number under the key \"version\", but got something different."
      _ -> error $ "Expected a JSON Number under the key \"version\", but got something different."

    return $ Version vers
  --TODO remove this after shared-vault gets updated
  parseJSON (String o) =
    if Dl.isInfixOf "pingDetail" (T.unpack o) --NOTE THIS SHOULD be removed and is just a hack to get the user-x and builder-x node working.
      then return $ Version 0 -- Remove this once vault version is
      else typeMismatch "Version" (String o)
  parseJSON wat = typeMismatch "Version " wat
