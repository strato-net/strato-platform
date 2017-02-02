{-# LANGUAGE
    TypeApplications
#-}
module BlockApps.Bloc.APISpec where

import Servant.Aeson.GenericSpecs
import Test.Hspec

import BlockApps.Bloc.API

spec :: Spec
spec = apiRoundtripSpecs (Proxy @ BlocAPI)
