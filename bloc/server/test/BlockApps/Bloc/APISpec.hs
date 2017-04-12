{-# LANGUAGE
    TypeApplications
#-}
module BlockApps.Bloc.APISpec where

import Servant.Aeson.GenericSpecs
import Test.Hspec
import Test.Hspec.QuickCheck

import BlockApps.Bloc.API

spec :: Spec
spec = modifyMaxSize (const 10) $ apiRoundtripSpecs (Proxy @ BlocAPI)
