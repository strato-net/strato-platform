{-# LANGUAGE TemplateHaskell #-}

module Options where

import           HFlags
import           Network

defineFlag "u:pguser" ("postgres" :: String) "Postgres user"
defineFlag "P:pghost" ("localhost" :: String) "Postgres hostname"
defineFlag "pgport" ("5432" :: String) "Postgres port"
defineFlag "p:password" ("" :: String) "Postgres password"
defineFlag "port" (8000::Int) "The port which the server runs on"
defineFlag "stratourl" ("stratoDev"::String) "URL of the Strato server Bloc will connect to"
defineFlag "cirrusurl" ("http://tester11.eastus.cloudapp.azure.com/cirrus"::String) "URL of the Cirrus server Bloc will connect to"
defineFlag "loglevel" (4::Int) "The log level for output messages"
defineFlag "blochost" ("localhost" :: HostName) "the host name for Bloc for the documentation"
defineFlag "blocport" (8000 :: Integer) "the port number for Bloc for the documentation"
defineFlag "bloc20path" ("/bloc/v2.0" :: FilePath) "the API path for Bloc v2.0 for the documentation"
defineFlag "bloc21path" ("/bloc/v2.1" :: FilePath) "the API path for Bloc v2.1 for the documentation"
