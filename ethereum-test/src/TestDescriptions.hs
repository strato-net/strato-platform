{-# LANGUAGE DeriveGeneric, OverloadedStrings, FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module TestDescriptions (
  Env(..),
  AddressState'(..),
  Exec(..),
  Transaction'(..),
--  CallCreate(..),
  RawData(..),
  InputWrapper(..),
  Test(..),
  Tests
  ) where

import Control.Applicative
import Data.Aeson
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.HashMap.Lazy as H
import qualified Data.Map as M
import Data.Maybe
import qualified Data.Text as T
import Data.Time.Clock
import Data.Time.Clock.POSIX
import GHC.Generics hiding (to)
import qualified Network.Haskoin.Internals as Haskoin
import Numeric

import Blockchain.Data.Address
import Blockchain.Data.Code
import Blockchain.Data.Log
import Blockchain.Database.MerklePatricia
import Blockchain.SHA
import Blockchain.Util
import Blockchain.VM.VMState

--import Debug.Trace

data Env =
  Env {
    currentCoinbase::Address,
    currentDifficulty::String,
    currentGasLimit::Integer,
    currentNumber::String,
    --currentTimestamp::String,
    currentTimestamp::UTCTime,
    previousHash::SHA
    } deriving (Generic, Show)

data AddressState' =
  AddressState' {
    nonce'::Integer,
    balance'::Integer,
    storage'::M.Map Integer Integer,
    contractCode'::Code
    } deriving (Generic, Show, Eq)

newtype RawData = RawData { theData::B.ByteString } deriving (Show, Eq)

data Exec =
  Exec {
    address'::Address,
    caller::Address,
    code::Code,
    data'::RawData,
    gas::String,
    gasPrice'::String,
    origin::Address,
    value'::String
    } deriving (Generic, Show)

data Transaction' =
  Transaction' {
    tData'::RawData,
    tGasLimit'::String,
    tGasPrice'::String,
    tNonce'::String,
    tSecretKey'::Haskoin.PrvKey,
    tTo'::Maybe Address,
    tValue'::String
    } deriving (Show)

data InputWrapper = IExec Exec | ITransaction Transaction' deriving (Show)

{-
data CallCreate =
  CallCreate {
    ccData::String,
    ccDestination::String,
    ccGasLimit::String,
    ccValue::String
    } deriving (Show, Eq)
-}

{-
data Log =
  Log {
    logAddress::String,
    logBloom'::String,
    logData::String,
    logTopics::[String]
    } deriving (Show, Eq)
-}

data Test =
  Test {
    callcreates::Maybe [DebugCallCreate],
    env::Env,
    theInput::InputWrapper,
    {-
    exec::Maybe Exec,
    transaction::Maybe Transaction,
    -}
    remainingGas::Maybe Integer,
    logs'::[Log],
    out::RawData,
    pre::M.Map Address AddressState',
    post::M.Map Address AddressState'
    } deriving (Generic, Show)

type Tests = M.Map String Test

convertAddressAndAddressInfo::M.Map String AddressState'->M.Map Address AddressState'
convertAddressAndAddressInfo = M.fromList . map convertPre' . M.toList
    where
      convertPre'::(String, AddressState')->(Address, AddressState')
      convertPre' (addressString, addressState) = (Address $ fromInteger $ byteString2Integer $ fst $ B16.decode $ BC.pack addressString, addressState)


instance FromJSON Test where
  parseJSON (Object v) | H.member "exec" v =
    test <$>
    v .:? "callcreates" <*>
    v .: "env" <*>
    v .: "exec" <*>
{-    v .: "exec" <*>
    v .: "transaction" <*> -}
    v .:? "gas" <*>
    v .:? "logs" .!= [] <*>
    v .:? "out" .!= (RawData B.empty) <*>
    v .: "pre" <*>
    v .:? "post" .!= M.empty
    where
       test v1 v2 exec gas v5 v6 v7 v8 = Test v1 v2 (IExec exec) (fmap read gas) v5 v6 (convertAddressAndAddressInfo v7) (convertAddressAndAddressInfo v8)
  parseJSON (Object v) | H.member "transaction" v =
    test <$>
    v .:? "callcreates" <*>
    v .: "env" <*>
    v .: "transaction" <*>
{-    v .: "exec" <*>
    v .: "transaction" <*> -}
    v .:? "gas" <*>
    v .:? "logs" .!= [] <*>
    v .:? "out" .!= (RawData B.empty) <*>
    v .: "pre" <*>
    v .:? "post" .!= M.empty
    where
       test v1 v2 transaction gas v5 v6 v7 v8 = Test v1 v2 (ITransaction transaction) (fmap read gas) v5 v6 (convertAddressAndAddressInfo v7) (convertAddressAndAddressInfo v8)
  parseJSON x = error $ "Missing case in parseJSON for Test: " ++ show x


--Same as an Integer, but can be pulled from json files as either a json number or string (like "2")
newtype SloppyInteger = SloppyInteger Integer

sloppyInteger2Integer::SloppyInteger->Integer
sloppyInteger2Integer (SloppyInteger x) = x

instance FromJSON SloppyInteger where
  parseJSON (Number x) = return $ SloppyInteger $ floor x
  parseJSON (String x) = return $ SloppyInteger $ floor $ (read $ T.unpack x::Double)
  parseJSON x = error $ "Wrong format when trying to parse SloppyInteger from JSON: " ++ show x

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

instance FromJSON (Maybe Address) where
  parseJSON (String "") = pure Nothing
  parseJSON (String v) = fmap Just $ parseJSON (String v)
  parseJSON x = error $ "Wrong format when trying to parse 'Maybe Address' from JSON: " ++ show x

sloppyParseHexNumber::T.Text->Integer
sloppyParseHexNumber x =
  case readHex x' of
   [(val, "")] -> val
   _ -> error $ "bad value passed to sloppyParseHexNumber: " ++ show x
  where
    x' = removeOptional0x $ T.unpack x
    removeOptional0x ('0':'x':rest) = rest
    removeOptional0x x = x                                  

sloppyParseHexByteString::T.Text->B.ByteString
sloppyParseHexByteString x =
  case B16.decode $ BC.pack x' of
   (val, "") -> val
   _ -> error $ "bad value passed to sloppyParseHexNumber: " ++ show x
  where
    x' = removeOptional0x $ T.unpack x
    removeOptional0x ('0':'x':rest) = rest
    removeOptional0x x = x                                  
         
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
      transaction' d gl gp n sk to' v =
        let fixedTo =
              if T.null to'
              then Nothing
              else Just $ Address $ fromIntegral $ sloppyParseHexNumber to'
        in Transaction' d gl gp n sk fixedTo v
  parseJSON x = error $ "Wrong format when trying to parse Transaction' from JSON: " ++ show x

instance FromJSON Env where
  parseJSON (Object v) =
    env' <$>
    v .: "currentCoinbase" <*>
    v .: "currentDifficulty" <*>
    v .: "currentGasLimit" <*>
    v .: "currentNumber" <*>
    v .: "currentTimestamp" <*>
    v .:? "previousHash" .!= SHA 0 --error "previousHash not set"
    where
      env' v1 v2 currentGasLimit' v4 currentTimestamp' v6 =
        Env v1 v2 (read currentGasLimit') v4 (posixSecondsToUTCTime . fromInteger . sloppyInteger2Integer $ currentTimestamp') v6
  parseJSON x = error $ "Wrong format when trying to parse Env from JSON: " ++ show x


{-
instance FromJSON AddressState where
  parseJSON (Object v) =
    addressState <$>
    v .: "nonce" <*>
    v .: "balance" <*>
    v .: "storage" <*>
    v .: "code"
    where
      addressState::String->String->Object->SHA->AddressState
      addressState w x y z = AddressState (read w) (read x) emptyTriePtr z
  parseJSON x = error $ "Wrong format when trying to parse AddressState from JSON: " ++ show x
-}

instance FromJSON AddressState' where
  parseJSON (Object v) =
    addressState' <$>
    v .: "nonce" <*>
    v .: "balance" <*>
    v .: "storage" <*>
    v .: "code"
    where
      addressState'::String->String->M.Map String String->Code->AddressState'
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

instance FromJSON Log where
  parseJSON (Object v) =
    log' <$>
    v .: "address" <*>
    v .: "bloom" <*>
    v .: "data" <*>
    v .: "topics"
    where
      log' v1 v2 d v4 = Log v1 (fromIntegral $ byteString2Integer $ fst $ B16.decode v2) (sloppyParseHexByteString d) v4
  parseJSON x = error $ "Wrong format when trying to parse Log from JSON: " ++ show x

b16_decode_optional0x::B.ByteString->(B.ByteString, B.ByteString)
b16_decode_optional0x x = 
  case BC.unpack x of
    ('0':'x':rest) -> B16.decode $ BC.pack rest
    _ -> B16.decode x


{- DOIT Readd
instance FromJSON Address where
  parseJSON =
    withText "Address" $
    pure . Address . fromIntegral . byteString2Integer . fst . b16_decode_optional0x . BC.pack . T.unpack
-}

{- DOIT Readd
instance FromJSON B.ByteString where
  parseJSON =
    withText "Address" $
    pure . string2ByteString . T.unpack
    where
      string2ByteString::String->B.ByteString
      string2ByteString ('0':'x':rest) = fst . B16.decode . BC.pack $ rest
      string2ByteString x = fst . B16.decode . BC.pack $ x
-}

instance FromJSON Code where
  parseJSON =
    withText "SHA" $
    pure . string2Code . T.unpack
    where
      string2Code::String->Code
      string2Code ('0':'x':rest) = Code . fst . B16.decode . BC.pack $ rest
      string2Code x = error $ "string2Code called with input of wrong format: " ++ x

instance FromJSON Haskoin.PrvKey where
  parseJSON =
    withText "PrvKey" $
    pure . fromJust . Haskoin.makePrvKey . fromInteger . byteString2Integer . fst . B16.decode . BC.pack . T.unpack

instance FromJSON RawData where
  parseJSON =
    withText "RawData" $
    pure . string2RawData . T.unpack
    where
      string2RawData::String->RawData
      string2RawData x = RawData . fst . b16_decode_optional0x . BC.pack $ x

{- DOIT Readd
instance FromJSON SHA where
  parseJSON =
    withText "SHA" $
    pure . string2SHA . T.unpack
    where
      string2SHA::String->SHA
      string2SHA ('0':'x':rest) = SHA . fromIntegral . byteString2Integer . fst . B16.decode . BC.pack $ rest
      string2SHA x = SHA . fromIntegral . byteString2Integer . fst . B16.decode . BC.pack $ x
-}

{- DOIT Readd
instance FromJSON SHAPtr where
  parseJSON =
    withText "SHAPtr" $
    pure . SHAPtr . fst . B16.decode . BC.pack . T.unpack
-}
