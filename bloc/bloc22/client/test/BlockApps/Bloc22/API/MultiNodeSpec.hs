{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedLists   #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE ScopedTypeVariables   #-}


module BlockApps.Bloc22.API.MultiNodeSpec where


import           Servant.Client
import Data.Text
import Data.Maybe
import Data.Monoid ((<>))
import           Test.Hspec
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Test.QuickCheck.Arbitrary
import Test.QuickCheck.Gen

-- import           BlockApps.Bloc22.API.Contracts
import           BlockApps.Bloc22.API.SpecUtils
import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Client
import           BlockApps.Ethereum
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Xabi
-- import           BlockApps.Strato.Client
import           BlockApps.Strato.Types

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

spec :: SpecWith TestConfig
spec =
  describe "Multinode Tests" $ do
    describe "Contract Metadata" $ do
      describe "postUsersContractMethod" $ do
        it "should pull data from strato and call methods on SimpleStorage" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          pendingWith "Not Implemented"
      describe "postUsersContractMethodList" $ do
        it "should pull data from strato and call methods on SimpleStorage" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          pendingWith "Not Implemented"
      describe "getContractsState" $
        it "should pull data from strato and get contract state for an uploaded SimpleStorage" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "SimpleStorage"
          src' <- readSolFile "SimpleStorage.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              expectation = Map.fromList [("storedData",SolidityValueAsString "0")] :: Map Text SolidityValue
          cAddr <- createContractOnMulti src contractName Nothing config
          state <- getStateMulti cAddr contractName config
          (state Map.! ("storedData")) `shouldBe` (expectation Map.! "storedData")

createContractOnMulti :: Text
                      -> Text
                      -> Maybe (Map Text ArgValue)
                      -> TestConfig
                      -> IO Address
createContractOnMulti src cn args config@TestConfig{..} = do
  let blocclient = (ClientEnv mgr $ fromJust blocUrlMulti)
  addr <- fromEither =<< runClientM (postUsersUser userName pw) blocclient
  _ <- fromEither =<< runClientM (postUsersFill userName addr True) blocclient
  let
    postUsersContractRequest = PostUsersContractRequest
      { postuserscontractrequestSrc = src
      , postuserscontractrequestPassword = pw
      , postuserscontractrequestContract = Just cn
      , postuserscontractrequestArgs = args
      , postuserscontractrequestTxParams = txParams
      , postuserscontractrequestValue = Just $ Strung 0
      }
  result <- fromEither =<< (getResolvedTxMulti config $ runClientM (postUsersContract userName addr False postUsersContractRequest) blocclient)
  result `shouldSatisfy` (== Success) . blocTransactionStatus
  result `shouldSatisfy` isJust . blocTransactionTxResult
  result `shouldSatisfy` isJust . blocTransactionData
  let (Upload details) = fromJust $ blocTransactionData result
      (Unnamed caddr) = fromJust $ contractdetailsAddress details
  return caddr

getStateMulti :: Address -> Text -> TestConfig -> IO (Map Text SolidityValue)
getStateMulti addr cn TestConfig{..} = do
  Right contracts <- runClientM
    (getContractsState
      (ContractName cn)
      (Unnamed addr)
    )
    (ClientEnv mgr $ fromJust blocUrlMulti)
  return contracts


skipIfNotMultinode :: TestConfig -> IO ()
skipIfNotMultinode TestConfig{..} =
  case (blocUrlMulti, stratoUrlMulti) of
    (Just _, Just _) -> return ()
    _ -> pendingWith "Skipping due to lack of multinode parameters"
