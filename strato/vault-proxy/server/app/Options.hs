{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE QuasiQuotes #-}

module Options where

import           HFlags
import           Data.Text       as T

defineFlag "OAUTH_ENABLED" (True :: Bool) "Enable OAuth2"
defineFlag "OAUTH_DISCOVERY_URL" (T.pack "" :: Text) "OAuth2 Discovery URL"
defineFlag "OAUTH_JWT_USERNAME_PROPERTY" (T.pack "" :: Text) "OAuth2 JWT Username Property"
defineFlag "OAUTH_CLIENT_ID" (T.pack "" :: Text) "OAuth2 Client ID"
defineFlag "OAUTH_CLIENT_SECRET" (T.pack "" :: Text) "OAuth2 Client Secret"
defineFlag "OAUTH_RESERVE_SECONDS" (13 :: Int) "How long the system should reserve for the token to expire, default is 13 seconds."
defineFlag "OAUTH_SERVICE_USER_CLIENT_ID" (T.pack "" :: Text) "OAuth2 Service User Client ID"
defineFlag "OAUTH_SERVICE_USER_CLIENT_SECRET" (T.pack "" :: Text) "OAuth2 Service User Client Secret"
defineFlag "VAULT_URL" (T.pack "" :: Text) "The place where I go to visit THE VAULT 🔒."
defineFlag "VAULT_PORT" (8013 :: Int) "This is the place that the vault proxy will attempt to connect and will also communicate with. Same port is used for post and gets, just to let you know."
defineFlag "VAULT_PASSWORD" (T.pack "" :: Text) "This is the password that is used to log into the shared vault."
defineFlag "VAULT_PROXY_PORT" (8013 :: Int) "This is the port that the vault proxy will listen on."
defineFlag "VAULT_PROXY_URL" (T.pack "http://vault-proxy" :: Text) "This is the url that the vault proxy will listen on."