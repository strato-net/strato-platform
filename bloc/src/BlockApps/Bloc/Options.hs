{-# LANGUAGE
    TemplateHaskell
#-}

module BlockApps.Bloc.Options where

import HFlags

defineFlag "u:pguser" ("postgres" :: String) "Postgres user"
defineFlag "P:pghost" ("localhost" :: String) "Postgres hostname"
defineFlag "p:password" ("" :: String) "Postgres password"
defineFlag "port" (8000::Int) "The port which the server runs on"
defineFlag "stratourl" ("stratoDev"::String) "URL of the Strato server bloc will connect to"
