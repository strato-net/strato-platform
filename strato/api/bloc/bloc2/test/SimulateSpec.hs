{-# LANGUAGE OverloadedStrings #-}

-- | Wire-contract tests for the simulate endpoint's result types: the JSON
-- SMD parses, and the VM log shape (TraceLog) SimulatedEvent decodes.
module SimulateSpec (spec) where

import Bloc.API.Transaction
import Bloc.API.Users (BlocTransactionData (..), BlocTransactionStatus (..), UploadContractDetails (..))
import Data.Aeson (decode, encode, object, (.=))
import qualified Data.Aeson as Aeson
import qualified Data.Aeson.Types as Aeson
import qualified Data.Map as Map
import Test.Hspec

spec :: Spec
spec = do
  describe "BlocSimulateResult JSON" $ do
    it "serializes with the documented field names" $ do
      let r =
            BlocSimulateResult
              { blocsimulateStatus = Success,
                blocsimulateGasUsed = 420,
                blocsimulateResponse = Nothing,
                blocsimulateData = Just . Upload $ UploadContractDetails "C" Nothing,
                blocsimulateEvents = [SimulatedEvent "deadbeef" "Added" (Map.singleton "amount" "5")],
                blocsimulateError = Nothing,
                blocsimulateTrace = Nothing,
                blocsimulateEffect = Nothing
              }
      decode (encode r) `shouldBe` Just r
      case decode (encode r) :: Maybe Aeson.Value of
        Just (Aeson.Object o) -> do
          Aeson.parseMaybe (Aeson..: "status") o `shouldBe` Just Success
          Aeson.parseMaybe (Aeson..: "gasUsed") o `shouldBe` Just (420 :: Integer)
        other -> expectationFailure $ "expected a JSON object, got " ++ show other

    it "nests the castVoteOnIssue effect under the 'effect' key" $ do
      let effect =
            BlocSimulateResult
              { blocsimulateStatus = Success,
                blocsimulateGasUsed = 7,
                blocsimulateResponse = Nothing,
                blocsimulateData = Just . Call $ [],
                blocsimulateEvents = [],
                blocsimulateError = Nothing,
                blocsimulateTrace = Nothing,
                blocsimulateEffect = Nothing
              }
          r =
            BlocSimulateResult
              { blocsimulateStatus = Success,
                blocsimulateGasUsed = 1,
                blocsimulateResponse = Nothing,
                blocsimulateData = Nothing,
                blocsimulateEvents = [],
                blocsimulateError = Nothing,
                blocsimulateTrace = Nothing,
                blocsimulateEffect = Just effect
              }
      decode (encode r) `shouldBe` Just r
      case decode (encode r) :: Maybe Aeson.Value of
        Just (Aeson.Object o) ->
          Aeson.parseMaybe (Aeson..: "effect") o `shouldBe` Just effect
        other -> expectationFailure $ "expected a JSON object, got " ++ show other

    it "round-trips a failure with an error message" $ do
      let r =
            BlocSimulateResult
              { blocsimulateStatus = Failure,
                blocsimulateGasUsed = 0,
                blocsimulateResponse = Nothing,
                blocsimulateData = Nothing,
                blocsimulateEvents = [],
                blocsimulateError = Just "execution reverted: boom",
                blocsimulateTrace = Nothing,
                blocsimulateEffect = Nothing
              }
      decode (encode r) `shouldBe` Just r

  describe "SimulatedEvent" $
    it "decodes the VM's TraceLog shape" $ do
      let logJson = object ["address" .= ("00000000000000000000000000000000deadbeef" :: String), "name" .= ("Added" :: String), "args" .= object ["amount" .= ("5" :: String)]]
      Aeson.fromJSON logJson
        `shouldBe` Aeson.Success (SimulatedEvent "00000000000000000000000000000000deadbeef" "Added" (Map.singleton "amount" "5"))
