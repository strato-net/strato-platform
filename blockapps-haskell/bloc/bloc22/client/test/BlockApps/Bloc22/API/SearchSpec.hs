{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
module BlockApps.Bloc22.API.SearchSpec where

import           Servant.Client
import           Test.Hspec

import           BlockApps.Bloc22.API.Search
import           BlockApps.Bloc22.API.SpecUtils
import           BlockApps.Bloc22.Client
import           BlockApps.Solidity.Xabi

spec :: SpecWith TestConfig
spec = do

  describe "getSearchContract" $
    it "gets a list of addresses in a contract" $ \ TestConfig {..} -> do
      Right addrs <- runClientM
        (getSearchContract "SimpleStorage")
        (ClientEnv mgr blocUrl)
      addrs `shouldContain` [One $ Unnamed simpleStorageContractAddress]
