{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Blockchain.Data.Json where

import           Import

import           Blockchain.Data.Address
import           Blockchain.Data.Code
import           Blockchain.Data.DataDefs
import           Blockchain.Data.PersistTypes
import           Blockchain.Data.Transaction
import           Handler.Common

import           Data.Aeson
import           Data.ByteString
import           Data.ByteString.Base16       as B16
import           Data.ByteString.Lazy         as BS
import qualified Data.Text.Encoding           as T
import           Database.Persist
import           Database.Persist.Postgresql
import           Database.Persist.TH

import qualified Data.ByteString              as B
import qualified Database.Esqueleto           as E

import           Data.List
import           Debug.Trace
import           Numeric

import           Data.Maybe

import           Prelude                      as P
import           Prelude                      ((.), head)

jsonBlk :: (ToJSON a, Monad m) => a -> m Value
jsonBlk a = returnJson a

data Transaction' = Transaction' Transaction deriving (Eq, Show)

instance ToJSON Transaction' where
    toJSON (Transaction' tx@(MessageTX tnon tgp tgl tto tval td tr ts tv)) =
        object ["kind" .= ("Transaction" :: String), "nonce" .= tnon, "gasPrice" .= tgp, "gasLimit" .= tgl, "to" .= tto, "value" .= tval,
        "data" .= td, "r" .= showHex tr "", "s" .= showHex ts "", "v" .= showHex tv "",
        "transactionType" .= (show $ transactionSemantics $ tx)]
    toJSON (Transaction' tx@(ContractCreationTX tnon tgp tgl tval ti tr ts tv)) =
        object ["kind" .= ("Transaction" :: String), "nonce" .= tnon, "gasPrice" .= tgp, "gasLimit" .= tgl, "value" .= tval, "init" .= ti,
        "r" .= showHex tr "", "s" .= showHex ts "", "v" .= showHex tv "",
        "transactionType" .= (show $ transactionSemantics $ tx)]


instance FromJSON Transaction' where
    parseJSON (Object t) = do
      tto <- (t .:? "to")
      tnon <- (t .: "nonce")
      tgp <- (t .: "gasPrice")
      tgl <- (t .: "gasLimit")
      tval <- (t .: "value")
      tr <- (t .: "r")
      ts <- (t .: "s")
      tv <- (t .: "v")

      case tto of
        Nothing -> do
          ti <- (t .: "init")
          return (Transaction' (ContractCreationTX tnon tgp tgl tval ti tr ts tv))
        (Just to) -> do
          td <- (t .: "data")
          return (Transaction' (MessageTX tnon tgp tgl to tval td tr ts tv))

{-        case res of
          Nothing -> Transaction' ( ContractCreationTX <$>
                     (t .: "nonce") <*>
                     (t .: "gasPrice") <*>
                     (t .: "gasLimit") <*>
                     (t .: "value") <*>
                     (t .: "init") <*>
                     (t .: "r") <*>
                     (t .: "s") <*>
                     (t .: "v")
                    )
          _ ->      Transaction' ( MessageTX <$>
                     (t .: "nonce") <*>
                     (t .: "gasPrice") <*>
                     (t .: "gasLimit") <*>
                     (t .: "to" ) <*>
                     (t .: "value") <*>
                     (t .: "data") <*>
                     (t .: "r") <*>
                     (t .: "s") <*>
                     (t .: "v")
                    )
-}

tToTPrime :: Transaction -> Transaction'
tToTPrime x = Transaction' x

data Block' = Block' Block String deriving (Eq, Show)

instance ToJSON Block' where
      toJSON (Block' (Block bd rt bu) next) =
        object ["next" .= next, "kind" .= ("Block" :: String), "blockData" .= bdToBdPrime bd,
         "receiptTransactions" .= P.map tToTPrime rt,
         "blockUncles" .= P.map bdToBdPrime bu]

      toJSON _ = object ["malformed Block" .= True]

bToBPrime :: (String , Block) -> Block'
bToBPrime (s, x) = Block' x s

bToBPrime' :: Block -> Block'
bToBPrime' x = Block' x ""

data BlockData' = BlockData' BlockData deriving (Eq, Show)

instance ToJSON BlockData' where
      toJSON (BlockData' (BlockData ph uh cb@(Address a) sr tr rr lb d num gl gu ts ed non mh)) =
        object ["kind" .= ("BlockData" :: String), "parentHash" .= ph, "unclesHash" .= uh, "coinbase" .= (showHex a ""), "stateRoot" .= sr,
        "transactionsRoot" .= tr, "receiptsRoot" .= rr, "difficulty" .= d, "number" .= num,
        "gasLimit" .= gl, "gasUsed" .= gu, "timestamp" .= ts, "extraData" .= ed, "nonce" .= non,
        "mixHash" .= mh]
      toJSON _ = object ["malformed BlockData" .= True]

bdToBdPrime :: BlockData -> BlockData'
bdToBdPrime x = BlockData' x

data BlockDataRef' = BlockDataRef' BlockDataRef deriving (Eq, Show)

instance ToJSON BlockDataRef' where
      toJSON (BlockDataRef' (BlockDataRef ph uh cb@(Address a) sr tr rr lb d num gl gu ts ed non mh bi h pow isConf td)) =
        object ["parentHash" .= ph, "unclesHash" .= uh, "coinbase" .= (showHex a ""), "stateRoot" .= sr,
        "transactionsRoot" .= tr, "receiptsRoot" .= rr, "difficulty" .= d, "number" .= num,
        "gasLimit" .= gl, "gasUsed" .= gu, "timestamp" .= ts, "extraData" .= ed, "nonce" .= non,
        "mixHash" .= mh, "blockId" .= bi, "hash" .= h, "powVerified" .= pow, "isConfirmed" .= isConf, "totalDifficulty" .= td]



bdrToBdrPrime :: BlockDataRef -> BlockDataRef'
bdrToBdrPrime x = BlockDataRef' x

data AddressStateRef' = AddressStateRef' AddressStateRef String deriving (Eq, Show)

instance ToJSON AddressStateRef' where
    toJSON (AddressStateRef' (AddressStateRef a@(Address x) n b cr c bId bNum src) next) =
        object ["next" .= next, "kind" .= ("AddressStateRef" :: String), "address" .= (showHex x ""), "nonce" .= n, "balance" .= show b,
        "contractRoot" .= cr, "code" .= c, "latestBlockId" .= bId, "latestBlockNum" .= bNum, "source" .= src]

instance FromJSON AddressStateRef' where
    parseJSON (Object s) = do
      kind <- s .: "kind"
      if kind /= ("AddressStateRef" :: String)
        then fail "JSON is not AddressStateRef"
        else asrToAsrPrime' <$>
              (AddressStateRef
                <$> Address . fst . head . readHex <$> s .: "address"
                <*> s .: "nonce"
                <*> (read <$> (s .: "balance"))
                <*> s .: "contractRoot"
                <*> s .: "code"
                <*> s .: "latestBlockId"
                <*> s .: "latestBlockNum"
                <*> s .: "source"
              )
    parseJSON _ = fail "JSON not an object"


asrToAsrPrime :: (String, AddressStateRef) -> AddressStateRef'
asrToAsrPrime (s,x) = AddressStateRef' x s

asrToAsrPrime' :: AddressStateRef -> AddressStateRef'
asrToAsrPrime' x = AddressStateRef' x ""



--jsonFix x@(AddressStateRef a b c d e) = AddressStateRef' x
--jsonFix x@(BlockDataRef a b c d e f g h i j k l m n o p q) = BlockDataRef' x

data Address' = Address' Address deriving (Eq, Show)
adToAdPrime x = Address' x

--instance ToJSON Address' where
--  toJSON (Address' x) = object [ "address" .= (showHex x "") ]

data TransactionType = Contract | FunctionCall | Transfer  deriving (Eq, Show)

--instance ToJSON TransactionType where
--   toJSON x = object ["transactionType" .= show x]

transactionSemantics :: Transaction -> TransactionType
transactionSemantics t@(MessageTX tnon tgp tgl tto@(Address x) tval td tr ts tv) = work
    where work | (B.length td) > 0 = FunctionCall
               | otherwise = Transfer
transactionSemantics t@(ContractCreationTX tnon tgp tgl tval (Code ti) tr ts tv)
     | otherwise = Contract

isAddr :: Maybe Address -> Bool
isAddr = isJust
