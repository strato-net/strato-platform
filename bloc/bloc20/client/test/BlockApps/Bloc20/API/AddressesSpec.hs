{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE RecordWildCards #-}

module BlockApps.Bloc20.API.AddressesSpec where

import           Servant.Client
import           Test.Hspec

import           BlockApps.Bloc20.API.SpecUtils
import           BlockApps.Bloc20.Client

spec :: SpecWith TestConfig
spec =
  describe "getAddresses" $
    it "gets a list of addresses" $ \ TestConfig {..} -> do
      Right addrs <- runClientM getAddresses (ClientEnv mgr blocUrl)
      addrs `shouldContain` [userAddress,toUserAddress]
