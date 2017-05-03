{-# LANGUAGE TypeApplications #-}
module BlockApps.Bloc20.APISpec where

import           Servant.Aeson.GenericSpecs
import           Test.Hspec
import           Test.Hspec.QuickCheck

import           BlockApps.Bloc20.API

spec :: Spec
spec = modifyMaxSize (const 10) $ apiRoundtripSpecs (Proxy @ BlocAPI)
