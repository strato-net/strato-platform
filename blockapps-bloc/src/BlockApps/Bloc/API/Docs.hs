{-# LANGUAGE
    TypeApplications
#-}

module BlockApps.Bloc.API.Docs where

import Data.Proxy
import Servant.Docs

import BlockApps.Bloc.API

blocDocs :: API
blocDocs = docs (Proxy @ BlocAPI)

blocMarkdown :: String
blocMarkdown = markdown blocDocs
