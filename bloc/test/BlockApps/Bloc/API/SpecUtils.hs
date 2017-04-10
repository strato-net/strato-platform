{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    DataKinds
  , DeriveGeneric
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
  , RecordWildCards
#-}
module BlockApps.Bloc.API.SpecUtils where

import Data.Text (Text, pack)
import GHC.Generics
import Servant.Client
import Test.QuickCheck.Instances ()

import BlockApps.Ethereum
import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Crypto
import Network.HTTP.Client


data TestConfig = TestConfig
  { mgr :: Manager
  , blocUrl :: BaseUrl
  , stratoUrl :: BaseUrl
  -- , url :: BaseUrl
  , userName :: UserName
  , userAddress :: Address
  , toUserName :: UserName
  , toUserAddress :: Address
  , pw :: Password
  , simpleStorageContractName :: Text
  , simpleStorageContractAddress :: Address
  , testContractName :: Text
  , testContractAddress :: Address
  , simpleMappingContractName :: Text
  , simpleMappingContractAddress :: Address
  , txParams :: Maybe TxParams
  , simpleStorageSrc :: Text
  , testSrc :: Text
  , simpleMappingSrc :: Text
  , delay :: Int --microsecond
  } deriving (Generic)


contractFilePath :: String -> String
contractFilePath filename = "./test/Contracts/" ++ filename

readSolFile :: String -> IO Text
readSolFile filename = do
  let
    filepath = contractFilePath filename
  soliditySrc <- readFile filepath
  return (pack soliditySrc)
