{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    RecordWildCards
  , TypeApplications
#-}

module BlockApps.Bloc.API.AddressesSpec where

import Data.Either
import Data.Proxy
import Servant.Client
import Test.Hspec

import BlockApps.Bloc.API.Addresses
import BlockApps.Bloc.Server.Addresses
import BlockApps.Bloc.API.SpecUtils

instance MonadAddresses ClientM where
  getAddresses = client (Proxy @ GetAddresses)

spec :: SpecWith TestConfig
spec =
  describe "getAddresses" $
    it "gets a list of addresses" $ \ TestConfig {..} -> do
      addrsEither <- runClientM getAddresses (ClientEnv mgr blocUrl)
      addrsEither `shouldSatisfy` isRight
