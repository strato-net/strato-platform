{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
module BlockApps.Bloc20.API.SearchSpec where

import           Data.Either
import           Servant.Client
import           Test.Hspec

import           BlockApps.Bloc20.API.SpecUtils
import           BlockApps.Bloc20.Client
import           BlockApps.Solidity.Xabi

spec :: SpecWith TestConfig
spec = do

  describe "getSearchContract" $
    it "gets a list of addresses in a contract" $ \ TestConfig {..} -> do
      Right addrs <- runClientM
        (getSearchContract "SimpleStorage")
        (ClientEnv mgr blocUrl)
      addrs `shouldContain` [Unnamed simpleStorageContractAddress]

  describe "getSearchContractState" $
    it "gets the state of all variables in addresses in a contract" $ \ TestConfig {..} -> do
      pendingWith "getSearchContractState not yet implemented"
      responseEither <- runClientM
        (getSearchContractState "SimpleStorage")
        (ClientEnv mgr blocUrl)
      responseEither `shouldSatisfy` isRight

  describe "getSearchContractStateReduced" $
    it "gets the state of some variables in addresses in a contract" $ \ TestConfig {..} -> do
      pendingWith "getSearchContractStateReduced not yet implemented"
      responseEither <- runClientM
        (getSearchContractStateReduced "SimpleStorage" ["get"])
        (ClientEnv mgr blocUrl)
      responseEither `shouldSatisfy` isRight
