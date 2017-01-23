{-# LANGUAGE
    TypeApplications
#-}

module BlockApps.Bloc.API.Mock (mockServer) where

import Data.Proxy
import Servant
import Servant.Mock

import BlockApps.Bloc.API

mockServer :: Server BlocAPI
mockServer = mock (Proxy @ BlocAPI) Proxy
