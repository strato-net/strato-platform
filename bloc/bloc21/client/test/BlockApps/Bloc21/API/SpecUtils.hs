{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE DeriveGeneric         #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
module BlockApps.Bloc21.API.SpecUtils where

import           Data.Text                 (Text, pack)
import           GHC.Generics
import           Servant.Client
import           Test.QuickCheck.Instances ()

import           BlockApps.Bloc21.API.Utils
import           BlockApps.Bloc21.Crypto
import           BlockApps.Ethereum
import           Network.HTTP.Client


data TestConfig = TestConfig
  { mgr                          :: Manager
  , blocUrl                      :: BaseUrl
  , stratoUrl                    :: BaseUrl
  -- , url :: BaseUrl
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
  , txParams                     :: Maybe TxParams
  , simpleStorageSrc             :: Text
  , testSrc                      :: Text
  , simpleMappingSrc             :: Text
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
