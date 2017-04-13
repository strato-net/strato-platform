{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    OverloadedStrings
  , RecordWildCards
  , TypeApplications
#-}
module BlockApps.Bloc.API.SearchSpec where

import Data.Either
import Servant.Client
import Test.Hspec

import BlockApps.Bloc.API.SpecUtils
import BlockApps.Bloc.Client

spec :: SpecWith TestConfig
spec = do

  describe "getSearchContract" $
    it "gets a list of addresses in a contract" $ \ TestConfig {..} -> do
      addrsEither <- runClientM
        (getSearchContract "SimpleStorage")
        (ClientEnv mgr blocUrl)
      addrsEither `shouldSatisfy` isRight

  describe "getSearchContractState" $
    it "gets the state of all variables in addresses in a contract" $ \ TestConfig {..} -> do
      responseEither <- runClientM
        (getSearchContractState "SimpleStorage")
        (ClientEnv mgr blocUrl)
      responseEither `shouldSatisfy` isRight

  describe "getSearchContractStateReduced" $
    it "gets the state of some variables in addresses in a contract" $ \ TestConfig {..} -> do
      responseEither <- runClientM
        (getSearchContractStateReduced "SimpleStorage" ["get"])
        (ClientEnv mgr blocUrl)
      responseEither `shouldSatisfy` isRight
