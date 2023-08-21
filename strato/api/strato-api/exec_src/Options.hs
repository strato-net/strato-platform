{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE QuasiQuotes #-}

module Options where

import           HFlags
import           Blockchain.Strato.Model.Options (computeNetworkID)

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
defineFlag "txSizeLimit" (150000 :: Int) "The maximum length of a valid RLP encoded transaction bytestring"
defineFlag "accountNonceLimit" (1000 :: Integer) "The maximum number of transactions an account can make"
defineFlag "gasLimit" (1000000 :: Integer) "The maximum amount of gas a transaction can use"
defineFlag "identityServerUrl" ("" :: String) "The URL of the identity server" -- This could be used during the strato-getting started or default use with network flag
defineFlag "vaultProxyPort" ("8013" :: String) "URL to Vault"
defineFlag "userRegistryAddress" ("0000000000000000000000000000000000000720" :: String) "Address of the User Registry contract"
defineFlag "useWalletsByDefault" (False :: Bool) "Whether to redirect transactions to user wallet contracts by default"

--Simple helper functions
getIdServerUrl ::  String
getIdServerUrl = if flags_identityServerUrl == "" 
      then (case computeNetworkID of  
            7596898649924658542 -> "https://multinode301.ci.blockapps.net:8080" --todo: update this with actual id server for mercata-hydrogen
            6909499098523985262 -> "http://prodnet:8014" --todo: update this with actual id server for mercata prod net
            _ -> "http://172.17.0.1:8014")
      else flags_identityServerUrl