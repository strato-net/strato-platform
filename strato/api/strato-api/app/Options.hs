{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE QuasiQuotes #-}

module Options where

import           HFlags
import           Data.Text       as T

--defineFlag "u:pguser" ("postgres" :: String) "Postgres user"
--defineFlag "P:pghost" ("localhost" :: String) "Postgres hostname"
--defineFlag "pgport" ("5432" :: String) "Postgres port"
--defineFlag "p:password" ("" :: String) "Postgres password"
--defineFlag "port" (8000::Int) "The port which the server runs on"
--defineFlag "stratourl" ("http://strato-int.centralus.cloudapp.azure.com/strato-api/eth/v1.2"::String) "URL of the Strato server Bloc will connect to"
--defineFlag "vaultwrapperurl" ("http://strato-int.centralus.cloudapp.azure.com/strato/v2.3"::String) "URL of the Strato server Bloc will connect to"
--defineFlag "publicmode" (False::Bool) "Whether this is bloc in private or public mode"
--defineFlag "stateFetchLimit" (100::Integer) "The maximum number of array entries to return from the state route"
--defineFlag "nonceCounterTimeout" (10::Integer) "The number of seconds nonces are held in the global nonce counter cache"
--defineFlag "sourceCacheTimeout" (60::Integer) "The number of seconds nonces are held in the global source code cache"
--defineFlag "txQueueSize" (4096::Integer) "The maximum number of requests to queue"
defineFlag "gasOn" (True :: Bool) "Whether or not to throw an error if an account sending a TX has no balance - used in conjunction with the VM gasOn flag"
defineFlag "evmCompatible" (False :: Bool) "Whether to turn off STRATO enhancements or not"
defineFlag "VAULT_PROXY_PORT" (8013 :: Int) "This is the port that the vault proxy will listen on."
defineFlag "VAULT_PROXY_URL" (T.pack "http://strato" :: Text) "This is the url that the vault proxy will listen on."