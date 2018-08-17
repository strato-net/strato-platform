{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE QuasiQuotes #-}

module Options where

import           HFlags

defineFlag "u:pguser" ("postgres" :: String) "Postgres user"
defineFlag "P:pghost" ("localhost" :: String) "Postgres hostname"
defineFlag "pgport" ("5432" :: String) "Postgres port"
defineFlag "p:password" ("" :: String) "Postgres password"
defineFlag "port" (8000::Int) "The port which the server runs on"
defineFlag "stratourl" ("http://strato-int.centralus.cloudapp.azure.com/strato-api/eth/v1.2"::String) "URL of the Strato server Bloc will connect to"
defineFlag "vaultwrapperurl" ("http://strato-int.centralus.cloudapp.azure.com/strato/v2.3"::String) "URL of the Strato server Bloc will connect to"
defineFlag "loglevel" (4::Int) "The log level for output messages"
defineFlag "publicmode" (False::Bool) "Whether this is bloc in private or public mode"
