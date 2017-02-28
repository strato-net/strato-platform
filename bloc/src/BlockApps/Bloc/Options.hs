{-# LANGUAGE
    TemplateHaskell
#-}

module BlockApps.Bloc.Options where

import HFlags

defineFlag "u:pguser" ("postgres" :: String) "Postgres user"
defineFlag "P:pghost" ("localhost" :: String) "Postgres hostname"
defineFlag "p:password" ("" :: String) "Postgres password"
