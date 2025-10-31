{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Options where

import HFlags

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
defineFlag "vaultProxyPort" ("8013" :: String) "URL to Vault"
defineFlag "userRegistryAddress" ("4be508b4b59039cbacf5f18ccd9b67ab48e86e6d" :: String) "Address of the User Registry contract" -- TODO: Change back to 720 once we start deploying networks with UserRegistry in the genesis block
defineFlag "userRegistryCodeHash" ("02946aa18081cd1c540f931e600d58e1c1e21a447620fb318ddf57b29126720b" :: String) "Code hash of UserRegistry contract code collection"
defineFlag "useBuiltinUserRegistry" (True :: Bool) "Whether to use the code hash for the standard UserRegistry contracts"
defineFlag "useWalletsByDefault" (False :: Bool) "Whether to redirect transactions to user wallet contracts by default"