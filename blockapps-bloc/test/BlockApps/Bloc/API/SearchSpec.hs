{-# LANGUAGE
    OverloadedStrings
#-}
module BlockApps.Bloc.API.SearchSpec where

import Data.Either
import Network.HTTP.Client
import Servant.Client
import Test.Hspec

import BlockApps.Bloc.API.Search
import BlockApps.Bloc.API.Utils

spec :: Spec
spec = beforeAll (newManager defaultManagerSettings) $ do

  describe "getSearchContract" $
    it "gets a list of addresses in a contract" $ \ mgr -> do
      addrsEither <- runClientM
        (getSearchContract (ContractName "SimpleStorage"))
        (ClientEnv mgr bayar4a)
      addrsEither `shouldSatisfy` isRight

  describe "getSearchContractState" $
    it "gets the state of all variables in addresses in a contract" $ \ mgr -> do
      responseEither <- runClientM
        (getSearchContractState (ContractName "SimpleStorage"))
        (ClientEnv mgr bayar4a)
      responseEither `shouldSatisfy` isRight

  describe "getSearchContractStateReduced" $
    it "gets the state of some variables in addresses in a contract" $ \ mgr -> do
      responseEither <- runClientM
        (getSearchContractStateReduced (ContractName "SimpleStorage") ["get"])
        (ClientEnv mgr bayar4a)
      responseEither `shouldSatisfy` isRight
