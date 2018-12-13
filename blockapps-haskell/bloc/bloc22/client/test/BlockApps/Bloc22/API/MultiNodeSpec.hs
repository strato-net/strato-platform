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
        it "should pull data from strato and get contract state for an uploaded Util" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "Util"
          src' <- readSolFile "Util.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Nothing
          cAddr <- createContractOnMulti src contractName constArgs config
          void $ getStateLocal cAddr contractName config
        it "should pull data from strato and get contract state for an uploaded Version" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "Version"
          src' <- readSolFile "Version.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Nothing
          cAddr <- createContractOnMulti src contractName constArgs config
          void $ getStateLocal cAddr contractName config
        it "should pull data from strato and get contract state for an uploaded BidState" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "BidState"
          src' <- readSolFile "BidState.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Nothing
          cAddr <- createContractOnMulti src contractName constArgs config
          void $ getStateLocal cAddr contractName config
        it "should pull data from strato and get contract state for an uploaded Bid" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "Bid"
          src' <- readSolFile "Bid.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Just $ Map.fromList
                          [ ("_id", ArgInt 321)
                          , ("_name", ArgString "TestName")
                          , ("_supplier", ArgString "TestSupp")
                          , ("_amount", ArgInt 123)
                          ]
          cAddr <- createContractOnMulti src contractName constArgs config
          void $ getStateLocal cAddr contractName config
        it "should pull data from strato and get contract state for an uploaded ProjectState" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "ProjectState"
          src' <- readSolFile "ProjectState.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Nothing
          cAddr <- createContractOnMulti src contractName constArgs config
          void $ getStateLocal cAddr contractName config
        it "should pull data from strato and get contract state for an uploaded Project" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "Project"
          src' <- readSolFile "Project.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Just $ Map.fromList
                          [ ("_name", ArgString "TestName")
                          , ("_buyer", ArgString "TestBuyer")
                          , ("_description", ArgString "TestDesc")
                          , ("_spec", ArgString "TestSpec")
                          , ("_price", ArgInt 1)
                          , ("_created", ArgInt 2)
                          , ("_targetDelivery", ArgInt 3)
                          ]
          cAddr <- createContractOnMulti src contractName constArgs config
          void $ getStateLocal cAddr contractName config
        it "should pull data from strato and get contract state for an uploaded ProjectEvent" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "ProjectEvent"
          src' <- readSolFile "ProjectEvent.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Nothing
          cAddr <- createContractOnMulti src contractName constArgs config
          void $ getStateLocal cAddr contractName config
        it "should pull data from strato and get contract state for an uploaded ProjectManager" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "ProjectManager"
          src' <- readSolFile "ProjectManager.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Nothing
          cAddr <- createContractOnMulti src contractName constArgs config
          void $ getStateLocal cAddr contractName config
        it "should pull data from strato and get contract state for an uploaded UserRole" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "UserRole"
          src' <- readSolFile "UserRole.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Nothing
          cAddr <- createContractOnMulti src contractName constArgs config
          void $ getStateLocal cAddr contractName config
        it "should pull data from strato and get contract state for an uploaded User" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "User"
          src' <- readSolFile "User.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Just $ Map.fromList
                          [ ("_account", ArgString "deadbeef")
                          , ("_username", ArgString "username")
                          , ("_pwHash", ArgString "00000000000000000000000000000000000000000000000000000000beefdead")
                          , ("_id", ArgInt 1)
                          , ("_role", ArgInt 1)
                          ]
          cAddr <- createContractOnMulti src contractName constArgs config
          void $ getStateLocal cAddr contractName config
        it "should pull data from strato and get contract state for an uploaded UserManager" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "UserManager"
          src' <- readSolFile "UserManager.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Nothing
          cAddr <- createContractOnMulti src contractName constArgs config
          void $ getStateLocal cAddr contractName config
        it "should pull data from strato and get contract state for an uploaded AdminInterface" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "AdminInterface"
          src' <- readSolFile "AdminInterface.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Nothing
          cAddr <- createContractOnMulti src contractName constArgs config
          void $ getStateLocal cAddr contractName config
        it "should pull data from strato and get contract state for an uploaded Lottery" $ \ config@TestConfig {..} -> do
          skipIfNotMultinode config
          let contractName' = "Lottery"
          src' <- readSolFile "Lottery.sol"
          randNum <- (pack . show . abs) <$> (generate arbitrary :: IO Int)
          let contractName = contractName' <> "_" <> randNum
              src = replace contractName' contractName src'
              constArgs = Just $ Map.fromList
                          [ ("_ticketCount", ArgInt 10)
                          , ("_ticketPrice", ArgInt 5)
                          ]
          cAddr <- createContractOnMulti src contractName constArgs config
          void $ getStateLocal cAddr contractName config

createContractOnMulti :: Text
                      -> Text
                      -> Maybe (Map Text ArgValue)
                      -> TestConfig
                      -> IO Address
createContractOnMulti src cn args config@TestConfig{..} = do
  let blocclient = (ClientEnv mgr (fromJust blocUrlMulti) Nothing)
  addr <- fromEither =<< runClientM (postUsersUser userName pw) blocclient
  _ <- fromEither =<< runClientM (postUsersFill userName addr True) blocclient
  let
    postUsersContractRequest = PostUsersContractRequest
      { postuserscontractrequestSrc = src
      , postuserscontractrequestPassword = pw
      , postuserscontractrequestContract = Just cn
      , postuserscontractrequestArgs = args
      , postuserscontractrequestTxParams = testTxParams
      , postuserscontractrequestValue = Just $ Strung 0
      , postuserscontractrequestMetadata = Just $ Map.fromList [("src",src),("name",cn)]
      }
  result <- fromEither =<< (getResolvedTxMulti config $ runClientM (postUsersContract userName addr Nothing False postUsersContractRequest) blocclient)
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
        , postuserscontractmethodTxParams = testTxParams
        , postuserscontractmethodMetadata = Nothing
        }
  in fromEither =<<
     ( getResolvedTx config $
       runClientM
       ( postUsersContractMethod
         userName
         userAddress
         (ContractName contractName)
         cAddr
         Nothing
         False
         postUsersContractMethodRequest
       )
       (ClientEnv mgr blocUrl Nothing)
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
            , methodcallTxParams = testTxParams
            , methodcallMetadata = Nothing
            }
        }
  in getResolvedBatchTx config $
     runClientM
     ( postUsersContractMethodList
       userName
       userAddress
       Nothing
       False
       postMethodListRequest
     )
     (ClientEnv mgr blocUrl Nothing)

getStateLocal :: Address -> Text -> TestConfig -> IO (Map Text SolidityValue)
getStateLocal addr cn TestConfig{..} =
  fromEither =<<
  runClientM
  ( getContractsState
    (ContractName cn)
    (Unnamed addr)
    Nothing
    Nothing
    Nothing
    Nothing
    False
  )
  (ClientEnv mgr blocUrl Nothing)


skipIfNotMultinode :: TestConfig -> IO ()
skipIfNotMultinode TestConfig{..} =
  case (blocUrlMulti, stratoUrlMulti) of
    (Just _, Just _) -> return ()
    _ -> pendingWith "Skipping due to lack of multinode parameters"
