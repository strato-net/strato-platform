{-# LANGUAGE
    RecordWildCards
#-}

module BlockApps.Bloc.API.AddressesSpec where

import Data.Either
import Network.HTTP.Client
import Servant.Client
import Test.Hspec

import BlockApps.Bloc.API.Addresses
import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.API.SpecUtils

spec :: SpecWith TestConfig
spec =
  describe "getAddresses" $
    it "gets a list of addresses" $ \ TestConfig {..} -> do
      addrsEither <- runClientM getAddresses (ClientEnv mgr blocUrl)
      addrsEither `shouldSatisfy` isRight
