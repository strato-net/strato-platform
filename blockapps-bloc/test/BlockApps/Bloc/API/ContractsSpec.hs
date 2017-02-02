module BlockApps.Bloc.API.ContractsSpec where

import Data.Either
import Network.HTTP.Client
import Servant.Client
import Test.Hspec

import BlockApps.Bloc.API.Contracts
import BlockApps.Bloc.API.Utils

spec :: Spec
spec = beforeAll (newManager defaultManagerSettings) $
  describe "getContracts" $
    it "gets a list of contracts" $ \ mgr -> do
      contractsEither <- runClientM getContracts (ClientEnv mgr urlTesterBloc)
      contractsEither `shouldSatisfy` isRight
