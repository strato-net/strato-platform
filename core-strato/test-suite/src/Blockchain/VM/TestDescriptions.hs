{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.VM.TestDescriptions (
  Env(..),
  AddressState'(..),
  Exec(..),
  Transaction'(..),
  RawData(..),
  InputWrapper(..),
  Test(..),
  Tests
  ) where

import           Data.Aeson
import qualified Data.ByteString           as B
import qualified Data.ByteString.Base16    as B16
import qualified Data.ByteString.Char8     as BC
import qualified Data.HashMap.Lazy         as H
import qualified Data.Map                  as M
import           Data.Maybe
import qualified Data.Text                 as T
import           Data.Time.Clock
import           Data.Time.Clock.POSIX
import           GHC.Generics              hiding (to)
import qualified Network.Haskoin.Internals as Haskoin
import           Numeric

import           Blockchain.Data.Address
import           Blockchain.Data.Code
import           Blockchain.EVM.VMState
import           Blockchain.SHA
import           Blockchain.Util

data Env =
  Env {
    currentCoinbase   ::  Address,
    currentDifficulty ::  String,
    currentGasLimit   ::  Integer,
    currentNumber     ::  String,
    currentTimestamp  ::  UTCTime,
    previousHash      ::  Maybe SHA
    } deriving (Generic, Show, Eq)

data AddressState' =
  AddressState' {
    nonce'        ::  Integer,
    balance'      ::  Integer,
    storage'      ::  M.Map Integer Integer,
    contractCode' ::  Code
    } deriving (Generic, Show, Eq)

newtype RawData = RawData { theData  ::  B.ByteString } deriving (Show, Eq)

data Exec =
  Exec {
    address'  ::  Address,
    caller    ::  Address,
    code      ::  Code,
    data'     ::  RawData,
    gas'      ::  String,
    gasPrice' ::  String,
    origin    ::  Address,
    value'    ::  String
    } deriving (Generic, Show, Eq)

data Transaction' =
  Transaction' {
    tData'      ::  RawData,
    tGasLimit'  ::  String,
    tGasPrice'  ::  String,
    tNonce'     ::  String,
    tSecretKey' ::  Haskoin.PrvKey,
    tTo'        ::  Maybe Address,
    tValue'     ::  String
    } deriving (Show, Eq)

data InputWrapper = IExec Exec | ITransaction Transaction' deriving (Show, Eq)


data Test =
  Test {
    callcreates  ::  Maybe [DebugCallCreate],
    env          ::  Env,
    theInput     ::  InputWrapper,
    remainingGas ::  Maybe Int,
    out          ::  RawData,
    pre          ::  M.Map Address AddressState',
    post         ::  M.Map Address AddressState'
    } deriving (Generic, Show, Eq)

type Tests = M.Map String Test

instance FromJSON Test where
  parseJSON (Object v) | H.member "exec" v =
    test <$>
    v .:? "callcreates" <*>
    v .: "env" <*>
    v .: "exec" <*>
    v .:? "gas" <*>
    v .:? "out" .!= RawData B.empty <*>
    v .: "pre" <*>
    v .:? "post" .!= M.empty
    where
       test v1 v2 exec gas = Test v1 v2 (IExec exec) (fmap read gas)
  parseJSON (Object v) | H.member "transaction" v =
    test <$>
    v .:? "callcreates" <*>
    v .: "env" <*>
    v .: "transaction" <*>
    v .:? "gas" <*>
    v .:? "out" .!= RawData B.empty <*>
    v .: "pre" <*>
    v .:? "post" .!= M.empty
    where
       test v1 v2 transaction gas = Test v1 v2 (ITransaction transaction) (fmap read gas)
  parseJSON x = error $ "Missing case in parseJSON for Test: " ++ show x


--Same as an Integer, but can be pulled from json files as either a json number or string (like "2")
newtype SloppyInteger = SloppyInteger Integer

sloppyInteger2Integer  ::  SloppyInteger->Integer
sloppyInteger2Integer (SloppyInteger x) = x

instance FromJSON SloppyInteger where
  parseJSON (Number x) = return $ SloppyInteger $ floor x
  parseJSON (String x) = return $ SloppyInteger $ floor $ (read $ T.unpack x  ::  Double)
  parseJSON x          = error $ "Wrong format when trying to parse SloppyInteger from JSON: " ++ show x

instance FromJSON Exec where
  parseJSON (Object v) =
    Exec <$>
    v .: "address" <*>
    v .: "caller" <*>
    v .: "code" <*>
    v .: "data" <*>
    v .: "gas" <*>
    v .: "gasPrice" <*>
    v .: "origin" <*>
    v .: "value"
  parseJSON x = error $ "Wrong format when trying to parse Exec from JSON: " ++ show x

sloppyParseHexNumber  ::  T.Text->Integer
sloppyParseHexNumber x =
  case readHex x' of
   [(val, "")] -> val
   _           -> error $ "bad value passed to sloppyParseHexNumber: " ++ show x
  where
    x' = removeOptional0x $ T.unpack x
    removeOptional0x ('0':'x':rest) = rest
    removeOptional0x x''            = x''

sloppyParseHexByteString  ::  T.Text->B.ByteString
sloppyParseHexByteString x =
  case B16.decode $ BC.pack x' of
   (val, "") -> val
   _         -> error $ "bad value passed to sloppyParseHexNumber: " ++ show x
  where
    x' = removeOptional0x $ T.unpack x
    removeOptional0x ('0':'x':rest) = rest
    removeOptional0x x''            = x''

instance FromJSON Transaction' where
  parseJSON (Object v) =
    transaction' <$>
    v .: "data" <*>
    v .: "gasLimit" <*>
    v .: "gasPrice" <*>
    v .: "nonce" <*>
    v .: "secretKey" <*>
    v .: "to" <*>
    v .: "value"
    where
      transaction' d gl gp n sk to' v' =
        let fixedTo =
              if T.null to'
              then Nothing
              else Just $ Address $ fromIntegral $ sloppyParseHexNumber to'
        in Transaction' d gl gp n sk fixedTo v'
  parseJSON x = error $ "Wrong format when trying to parse Transaction' from JSON: " ++ show x

instance FromJSON Env where
  parseJSON (Object v) =
    env' <$>
    v .: "currentCoinbase" <*>
    v .: "currentDifficulty" <*>
    v .: "currentGasLimit" <*>
    v .: "currentNumber" <*>
    v .: "currentTimestamp" <*>
    v .:? "previousHash"
    where
      env' v1 v2 currentGasLimit' v4 currentTimestamp' v6 =
        Env v1 v2 (read currentGasLimit') v4 (posixSecondsToUTCTime . fromInteger . sloppyInteger2Integer $ currentTimestamp') v6
  parseJSON x = error $ "Wrong format when trying to parse Env from JSON: " ++ show x



instance FromJSON AddressState' where
  parseJSON (Object v) =
    addressState' <$>
    v .: "nonce" <*>
    v .: "balance" <*>
    v .: "storage" <*>
    v .: "code"
    where
      addressState'  ::  String->String->M.Map String String->Code->AddressState'
      addressState' w x y z = AddressState' (hexOrDecString2Integer w) (hexOrDecString2Integer x) (readMap y) z
      readMap = (M.map hexOrDecString2Integer) . (M.mapKeys hexOrDecString2Integer)
      hexOrDecString2Integer "0x" = 0
      hexOrDecString2Integer ('0':'x':rest) =
        let [(val, "")] = readHex rest
        in val
      hexOrDecString2Integer x = read x
  parseJSON x = error $ "Wrong format when trying to parse AddressState' from JSON: " ++ show x

instance FromJSON DebugCallCreate where
  parseJSON (Object v) =
    debugCallCreate' <$>
    v .: "data" <*>
    v .: "destination" <*>
    v .: "gasLimit" <*>
    v .: "value"
    where
      debugCallCreate' d v2 gasLimit val = DebugCallCreate (sloppyParseHexByteString d) v2 (read gasLimit) (read val)
  parseJSON x = error $ "Wrong format when trying to parse CallCreate from JSON: " ++ show x

b16_decode_optional0x  ::  B.ByteString->(B.ByteString, B.ByteString)
b16_decode_optional0x x =
  case BC.unpack x of
    ('0':'x':rest) -> B16.decode $ BC.pack rest
    _              -> B16.decode x


instance FromJSON Haskoin.PrvKey where
  parseJSON =
    withText "PrvKey" $
    pure . fromJust . Haskoin.makePrvKey . fromInteger . byteString2Integer . fst . B16.decode . BC.pack . T.unpack

instance FromJSON RawData where
  parseJSON =
    withText "RawData" $
    pure . string2RawData . T.unpack
    where
      string2RawData  ::  String->RawData
      string2RawData x = RawData . fst . b16_decode_optional0x . BC.pack $ x
