{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedLists   #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module BlockApps.Bloc22.API.E2ESpec where


import           Control.Concurrent
import qualified Data.ByteString.Base16           as Base16
import qualified Data.ByteString.Char8            as Char8
import           Data.Either
import qualified Data.Map                         as Map
import           Data.Maybe
import qualified Data.Text.Encoding               as Text
import qualified Data.Text                        as Text
import qualified Data.Vector                      as Vector
import           Servant.Client
import           Test.Hspec

import           BlockApps.Bloc22.API.Contracts
import           BlockApps.Bloc22.API.SpecUtils
import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Client
import           BlockApps.Ethereum
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Client
import           BlockApps.Strato.Types

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

spec :: SpecWith TestConfig
spec =
  describe "Integration Tests" $ do
    it "should send Ether between two users" $ \ testConfig@TestConfig {..} -> do
