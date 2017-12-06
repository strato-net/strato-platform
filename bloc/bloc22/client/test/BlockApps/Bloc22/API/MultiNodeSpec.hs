{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedLists   #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE ScopedTypeVariables   #-}


module BlockApps.Bloc22.API.MultiNodeSpec where


import           Servant.Client
import Data.Text
import Data.Monoid ((<>))
import           Test.Hspec
import Data.Map.Strict (Map)
import Test.QuickCheck.Arbitrary
import Test.QuickCheck.Gen

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
  describe "Multinode Tests" $ do
    describe "Contract Metadata" $ do
      describe "postUsersContractMethod" $ do
        it "should pull data from strato and call methods on SimpleStorage" $ \ _testConfig@TestConfig {..} -> do
          pendingWith "Not Implemented"
      describe "postUsersContractMethodList" $ do
        it "should pull data from strato and call methods on SimpleStorage" $ \ _testConfig@TestConfig {..} -> do
          pendingWith "Not Implemented"
      describe "getContractsState" $
        it "should pull data from strato and get contract state for an uploaded contract" $ \ config@TestConfig {..} -> do
        let contractName = "SimpleStorage"
        src' <- readSolFile "SimpleStorage.sol"
        randNum <- (pack . show) <$> (generate arbitrary :: IO Int)
        let src = replace contractName ( contractName <> "_" <> randNum) src'
            expectation = undefined
        cAddr <- createContractOnMulti src contractName config
        state <- getStateMulti cAddr contractName config
        state `shouldBe` expectation

createContractOnMulti :: Text -> Text -> TestConfig -> IO Address
createContractOnMulti src cn config@TestConfig{..} = do
  let
    postUsersContractRequest = PostUsersContractRequest
      { postuserscontractrequestSrc = src
      , postuserscontractrequestPassword = pw
      , postuserscontractrequestContract = Just cn
      , postuserscontractrequestArgs = Nothing
      , postuserscontractrequestTxParams = txParams
      , postuserscontractrequestValue = Just $ Strung 0
      }
  Right result <- getResolvedTx config $ runClientM (postUsersContract userName userAddress False postUsersContractRequest) (fromJust$  ClientEnv mgr blocUrlMulti)
  (Upload details) <- fromEither $ blocTransactionData result
  fromEither $ contractdetailsAddress details

getStateMulti :: Address -> Text -> TestConfig -> IO (Map Text SolidityValue)
getStateMulti = undefined
