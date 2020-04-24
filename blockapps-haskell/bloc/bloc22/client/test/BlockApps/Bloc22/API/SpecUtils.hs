{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
module BlockApps.Bloc22.API.SpecUtils where

import           Data.Text                 (Text, pack)
import           Test.Hspec
import           GHC.Generics
import Data.Either
import           Servant.Client
import           Test.QuickCheck.Instances ()

import           BlockApps.Bloc22.API
import           BlockApps.Bloc22.Client
import           BlockApps.Ethereum
import           Blockchain.Strato.Model.Keccak256
import           Network.HTTP.Client


data TestConfig = TestConfig
  { mgr                          :: Manager
  , blocUrl                      :: BaseUrl
  , stratoUrl                    :: BaseUrl
  , blocUrlMulti                 :: Maybe BaseUrl
  , stratoUrlMulti               :: Maybe BaseUrl
  , userName                     :: UserName
  , userAddress                  :: Address
  , toUserName                   :: UserName
  , toUserAddress                :: Address
  , pw                           :: Password
  , simpleStorageContractName    :: Text
  , simpleStorageContractAddress :: Address
  , testContractName             :: Text
  , testContractAddress          :: Address
  , simpleMappingContractName    :: Text
  , simpleMappingContractAddress :: Address
  , twoContractsContractName     :: Text
  , twoContractsContractAddress  :: Address
  , testTxParams                 :: Maybe TxParams
  , testTxParamsLowNonce         :: Maybe TxParams
  , simpleStorageSrc             :: Text
  , testSrc                      :: Text
  , simpleMappingSrc             :: Text
  , twoContractsSrc              :: Text
  , delay                        :: Int --microsecond
  } deriving (Generic)


contractFilePath :: String -> String
contractFilePath filename = "./test/Contracts/" ++ filename

readSolFile :: String -> IO Text
readSolFile filename = do
  let
    filepath = contractFilePath filename
  soliditySrc <- readFile filepath
  return (pack soliditySrc)

resolveTx :: TestConfig -> Keccak256 -> IO (Either ServantError BlocTransactionResult)
resolveTx testConfig@TestConfig{..} hash = do
  eResult <- runClientM (getBlocTransactionResult hash True) (ClientEnv mgr blocUrl Nothing)
  case eResult of
    Left _ -> return eResult
    Right result ->
      case blocTransactionStatus result of
        Pending -> resolveTx testConfig hash
        _ -> return eResult

getResolvedTx :: TestConfig -> IO (Either ServantError BlocTransactionResult) -> IO (Either ServantError BlocTransactionResult)
getResolvedTx testConfig io = do
  eResult <- io
  case eResult of
    Left _ -> return eResult
    Right result -> resolveTx testConfig $ blocTransactionHash result

getResolvedBatchTx :: TestConfig -> IO (Either ServantError [BlocTransactionResult]) -> IO [Either ServantError BlocTransactionResult]
getResolvedBatchTx testConfig io = do
  eResult <- io
  case eResult of
    Left err -> return [Left err]
    Right results -> mapM (resolveTx testConfig . blocTransactionHash) results

resolveTxMulti :: TestConfig -> Keccak256 -> IO (Either ServantError BlocTransactionResult)
resolveTxMulti testConfig@TestConfig{..} hash = do
  let Just blocclient = blocUrlMulti
  eResult <- runClientM (getBlocTransactionResult hash True) (ClientEnv mgr blocclient Nothing)
  case eResult of
    Left _ -> return eResult
    Right result ->
      case blocTransactionStatus result of
        Pending -> resolveTxMulti testConfig hash
        _ -> return eResult

getResolvedTxMulti :: TestConfig -> IO (Either ServantError BlocTransactionResult) -> IO (Either ServantError BlocTransactionResult)
getResolvedTxMulti testConfig io = do
  eResult <- io
  case eResult of
    Left _ -> return eResult
    Right result -> resolveTxMulti testConfig $ blocTransactionHash result

resolveBlocTx :: BlocTransactionResult -> ClientM BlocTransactionResult
resolveBlocTx bloc = do
  result <- getBlocTransactionResult (blocTransactionHash bloc) True
  case blocTransactionStatus result of
    Pending -> resolveBlocTx result
    _ -> return result

fromEither :: (Show b, Show a) => Either b a -> IO a
fromEither x = do
  logleft x
  x `shouldSatisfy` isRight
  let Right r = x
  return r

logleft :: (Show b) => Either b a -> IO ()
logleft x = case x of
  Left err -> print err
  Right _ -> return ()

