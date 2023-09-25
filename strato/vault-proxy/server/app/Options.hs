{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Options where

import Data.Text as T
import HFlags

defineFlag "OAUTH_DISCOVERY_URL" (T.pack "" :: Text) "OAuth2 Discovery URL"
defineFlag "OAUTH_CLIENT_ID" (T.pack "" :: Text) "OAuth2 Client ID"
defineFlag "OAUTH_CLIENT_SECRET" (T.pack "" :: Text) "OAuth2 Client Secret"
defineFlag "OAUTH_RESERVE_SECONDS" (13 :: Int) "How long the system should reserve for the token to expire, default is 13 seconds."
defineFlag "VAULT_URL" (T.pack "" :: Text) "The place where I go to visit THE VAULT 🔒."
defineFlag "VAULT_PROXY_PORT" (8013 :: Int) "This is the port that the vault proxy will listen on."
defineFlag "VAULT_PROXY_URL" (T.pack "http://localhost" :: Text) "This is the url that the vault proxy will listen on."
defineFlag "VAULT_PROXY_DEBUG" (False :: Bool) "If this is set to 1 then the proxy will print out the requests and responses, along with other information."
