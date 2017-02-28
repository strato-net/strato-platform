{-# LANGUAGE
    TemplateHaskell
#-}

module BlockApps.Bloc.Options where

import HFlags

defineFlag "u:pguser" ("" :: String) "Postgres user"
defineFlag "P:pghost" ("" :: String) "Postgres hostname"
defineFlag "p:password" ("" :: String) "Postgres password"
