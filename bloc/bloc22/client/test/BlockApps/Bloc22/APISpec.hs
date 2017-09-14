{-# LANGUAGE TypeApplications #-}
module BlockApps.Bloc22.APISpec where

import           Servant.Aeson.GenericSpecs
import           Test.Hspec
import           Test.Hspec.QuickCheck

import           BlockApps.Bloc22.API

spec :: Spec
spec = modifyMaxSize (const 10) $ apiRoundtripSpecs (Proxy @ BlocAPI)
