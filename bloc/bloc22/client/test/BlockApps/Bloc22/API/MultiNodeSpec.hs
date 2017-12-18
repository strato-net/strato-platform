{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedLists   #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE ScopedTypeVariables   #-}


module BlockApps.Bloc22.API.MultiNodeSpec where


import           Servant.Client
import Control.Monad (void)
import Data.Text hiding (replicate)
import Data.Maybe
import Data.Either (isRight)
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
          let contractName' = "SimpleStorage"
          src' <- readSolFile "SimpleStorage.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Nothing
              args = Map.empty
              method = "get"
              expectation = Call [SolidityValueAsString "0"]
          cAddr <- createContractOnMulti src contractName constArgs config
          result <- callMethodLocal method cAddr contractName args config
          fromJust (blocTransactionData result) `shouldBe` expectation
        it "should pull data from strato and call methods on AppMetadata" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "AppMetadata"
          src' <- readSolFile "AppMetadata.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Just $ Map.fromList
                          [ ("_appName", ArgString "TestApp")
                          , ("_version", ArgString "TestVersion")
                          , ("_url", ArgString "TestUrl")
                          , ("_description", ArgString "TestDescription")
                          ]
              args = Map.fromList
                     [ ("_appName", ArgString "TestAppUpdate")
                     , ("_version", ArgString "TestVersionUpdate")
                     , ("_url", ArgString "TestUrlUpdate")
                     , ("_description", ArgString "TestDescriptionUpdate")
                     ]
              method = "update"
          cAddr <- createContractOnMulti src contractName constArgs config
          result <- callMethodLocal method cAddr contractName args config
          blocTransactionData result `shouldSatisfy` isJust
      describe "postUsersContractMethodList" $ do
        it "should pull data from strato and call methods on SimpleStorage" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "SimpleStorage"
          src' <- readSolFile "SimpleStorage.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              method = "get"
              args = Map.empty
          cAddr <- createContractOnMulti src contractName Nothing config
          results <- callMethodListLocal method cAddr contractName args config
          let eResults = sequence results
          eResults `shouldSatisfy` isRight
        it "should pull data from strato and call methods on AppMetadata" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "AppMetadata"
          src' <- readSolFile "AppMetadata.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Just $ Map.fromList
                          [ ("_appName", ArgString "TestApp")
                          , ("_version", ArgString "TestVersion")
                          , ("_url", ArgString "TestUrl")
                          , ("_description", ArgString "TestDescription")
                          ]
              args = Map.fromList
                     [ ("_appName", ArgString "TestAppUpdate")
                     , ("_version", ArgString "TestVersionUpdate")
                     , ("_url", ArgString "TestUrlUpdate")
                     , ("_description", ArgString "TestDescriptionUpdate")
                     ]
              method = "update"
          cAddr <- createContractOnMulti src contractName constArgs config
          results <- callMethodListLocal method cAddr contractName args config
          let eResults = sequence results
          eResults `shouldSatisfy` isRight
      describe "getContractsState" $ do
        it "should pull data from strato and get contract state for an uploaded SimpleStorage" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "SimpleStorage"
          src' <- readSolFile "SimpleStorage.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              expectation = Map.fromList [("storedData",SolidityValueAsString "0")] :: Map Text SolidityValue
          cAddr <- createContractOnMulti src contractName Nothing config
          state <- getStateLocal cAddr contractName config
          (state Map.! ("storedData")) `shouldBe` (expectation Map.! "storedData")
        it "should pull data from strato and get contract state for an uploaded AppMetadata" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "AppMetadata"
          src' <- readSolFile "AppMetadata.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Just $ Map.fromList
                          [ ("_appName", ArgString "TestApp")
                          , ("_version", ArgString "TestVersion")
                          , ("_url", ArgString "TestUrl")
                          , ("_description", ArgString "TestDescription")
                          ]
          cAddr <- createContractOnMulti src contractName constArgs config
          void $ getStateLocal cAddr contractName config
        it "should pull data from strato and get contract state for an uploaded ErrorCodes" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "ErrorCodes"
          src' <- readSolFile "ErrorCodes.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Nothing
          cAddr <- createContractOnMulti src contractName constArgs config
          void $ getStateLocal cAddr contractName config

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

callMethodLocal :: Text
                -> Address
                -> Text
                -> Map Text ArgValue
                -> TestConfig
                -> IO BlocTransactionResult
callMethodLocal method cAddr contractName methodArgs config@TestConfig{..} =
  let postUsersContractMethodRequest =
        PostUsersContractMethodRequest
        { postuserscontractmethodPassword = pw
        , postuserscontractmethodMethod = method
        , postuserscontractmethodArgs = methodArgs
        , postuserscontractmethodValue = Just $ Strung 0
        , postuserscontractmethodTxParams = txParams
        }
  in fromEither =<<
     ( getResolvedTx config $
       runClientM
       ( postUsersContractMethod
         userName
         userAddress
         (ContractName contractName)
         cAddr
         False
         postUsersContractMethodRequest
       )
       (ClientEnv mgr blocUrl)
     )

callMethodListLocal :: Text
                    -> Address
                    -> Text
                    -> Map Text ArgValue
                    -> TestConfig
                    -> IO [Either ServantError BlocTransactionResult]
callMethodListLocal method cAddr contractName args config@TestConfig{..} =
  let postMethodListRequest =
        PostMethodListRequest
        { postmethodlistrequestPassword = pw
        , postmethodlistrequestResolve = False
        , postmethodlistrequestTxs =
            replicate 3
            MethodCall
            { methodcallContractName = contractName
            , methodcallContractAddress = cAddr
            , methodcallMethodName = method
            , methodcallArgs = args
            , methodcallValue = Strung 0
            , methodcallTxParams = txParams
            }
        }
  in getResolvedBatchTx config $
     runClientM
     ( postUsersContractMethodList
       userName
       userAddress
       False
       postMethodListRequest
     )
     (ClientEnv mgr blocUrl)

getStateLocal :: Address -> Text -> TestConfig -> IO (Map Text SolidityValue)
getStateLocal addr cn TestConfig{..} =
  fromEither =<<
  runClientM
  ( getContractsState
    (ContractName cn)
    (Unnamed addr)
  )
  (ClientEnv mgr blocUrl)


skipIfNotMultinode :: TestConfig -> IO ()
skipIfNotMultinode TestConfig{..} =
  case (blocUrlMulti, stratoUrlMulti) of
    (Just _, Just _) -> return ()
    _ -> pendingWith "Skipping due to lack of multinode parameters"
