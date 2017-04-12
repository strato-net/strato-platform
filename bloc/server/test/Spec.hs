{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    OverloadedStrings
  , TypeApplications
#-}

module Main where

import Test.Hspec

import qualified BlockApps.Bloc.API.AddressesSpec as Addresses
import qualified BlockApps.Bloc.API.ContractsSpec as Contracts
import qualified BlockApps.Bloc.API.SearchSpec as Search
import qualified BlockApps.Bloc.API.UsersSpec as Users
import BlockApps.Bloc.API.E2ESpec as E2E
import TestSetup
-- import qualified BlockApps.Bloc.APISpec as API


main :: IO ()
main = hspec $ do
  -- API.spec
  beforeAll setup $ do
    Addresses.spec
    Contracts.spec
    Search.spec
    Users.spec
    E2E.spec

