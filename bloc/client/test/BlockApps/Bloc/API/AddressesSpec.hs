{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    RecordWildCards
  , TypeApplications
#-}

module BlockApps.Bloc.API.AddressesSpec where

import Servant.Client
import Test.Hspec

import BlockApps.Bloc.API.SpecUtils
import BlockApps.Bloc.Client

spec :: SpecWith TestConfig
spec =
  describe "getAddresses" $
    it "gets a list of addresses" $ \ TestConfig {..} -> do
      Right addrs <- runClientM getAddresses (ClientEnv mgr blocUrl)
      addrs `shouldContain` [userAddress,toUserAddress]
