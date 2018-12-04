{-# LANGUAGE DataKinds           #-}
{-# LANGUAGE DeriveGeneric       #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}

--TODO : Take this next line out
{-# OPTIONS_GHC -fno-warn-orphans #-}


module Blockchain.Data.Json where

import           Blockchain.Data.Address
import           Blockchain.Data.Block
import           Blockchain.Data.Code
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Transaction
import           Blockchain.Format
import           Blockchain.Strato.Model.ExtendedWord (Word256)
import           Blockchain.Util                      (toMaybe)

import           Data.Aeson
import           Data.Aeson.Types                     (Parser)
import qualified Data.ByteString                      as B
import qualified Data.ByteString.Base16               as B16
import qualified Data.Map.Strict                      as M
import           Data.Maybe
import qualified Data.Text.Encoding                   as T
import           Data.Time.Calendar
import           Data.Time.Clock
import           Data.Word
import           GHC.Generics
import           Numeric
import           Text.Read

jsonBlk :: (ToJSON a, Monad m) => a -> m Value
jsonBlk = return . toJSON

data RawTransaction' = RawTransaction' RawTransaction String deriving (Eq, Show, Generic)

{- note we keep the file MiscJSON around for the instances we don't want to export - ByteString, Point -}

instance ToJSON RawTransaction' where
    toJSON (RawTransaction' rt@(RawTransaction t (Address fa) non gp gl (Just (Address ta)) val cod cid r s v md bn h o) next) =
        object $ ["next" .= next, "from" .= showHex fa "", "nonce" .= non, "gasPrice" .= gp, "gasLimit" .= gl,
        "to" .= showHex ta "" , "value" .= show val, "codeOrData" .= cod,
        "r" .= showHex r "",
        "s" .= showHex s "",
        "v" .= showHex v "",
        "blockNumber" .= bn,
        "hash" .= h,
        "transactionType" .= (show $ rawTransactionSemantics rt),
        "timestamp" .= show t,
        "origin" .= format o
               ] ++ (("chainId" .=) <$> maybeToList (toMaybe 0 cid))
                 ++ (("metadata" .=) <$> maybeToList (M.fromList <$> md))
    toJSON (RawTransaction' rt@(RawTransaction t (Address fa) non gp gl Nothing val cod cid r s v md bn h o) next) =
        object $ ["next" .= next, "from" .= showHex fa "", "nonce" .= non, "gasPrice" .= gp, "gasLimit" .= gl,
        "value" .= show val, "codeOrData" .= cod, "chainId" .= cid,
        "r" .= showHex r "",
        "s" .= showHex s "",
        "v" .= showHex v "",
        "blockNumber" .= bn,
        "hash" .= h,
        "transactionType" .= (show $ rawTransactionSemantics rt),
        "timestamp" .= show t,
        "origin" .= format o
               ] ++ (("chainId" .=) <$> maybeToList (toMaybe 0 cid))
                 ++ (("metadata" .=) <$> maybeToList (M.fromList <$> md))

parseHexStr :: (Integral a) => Parser String -> Parser a
parseHexStr = fmap (fst . head . readHex)

instance FromJSON RawTransaction' where
    parseJSON (Object t) = do
      fa <- parseHexStr (t .: "from")
      tnon  <- t .: "nonce"
      tgp <- t .: "gasPrice"
      tgl <- t .: "gasLimit"
      tto <- fmap (fmap $ Address . fst . head . readHex) (t .:? "to")
      tval <- fmap read (t .: "value")
      tcd <- fmap (fst .  B16.decode . T.encodeUtf8 ) (t .: "codeOrData")
      cid <- fmap (fmap $ fst . head . readHex) (t .:? "chainId")
      (tr :: Integer) <- parseHexStr (t .: "r")
      (ts :: Integer) <- parseHexStr (t .: "s")
      (tv :: Word8) <- parseHexStr (t .: "v")
      md <- t .:? "metadata"
      bn <- t .:? "blockNumber" .!= (-1)
      h <- (t .: "hash")
      -- Unfortunately, time is rendered with `show` in ToJSON for RawTransaction'
      -- instead of using the ToJSON instance for UTCTime, and so it fails
      -- to parse in FromJSON for UTCTime.
      let defaultTime = UTCTime (fromGregorian 1982 11 24) (secondsToDiffTime 0)
      (rawTime :: String) <- t .:? "timestamp" .!= ""
      let (time :: UTCTime) = fromMaybe defaultTime . readMaybe $ rawTime
      o <- fmap read $ t .:? "origin" .!= "API"
      next <- t .:? "next" .!= ""

      return (RawTransaction'
               (RawTransaction
                 time
                 (Address fa)
                 (tnon :: Integer)
                 (tgp :: Integer)
                 (tgl :: Integer)
                 (tto :: Maybe Address)
                 (tval :: Integer)
                 (tcd :: B.ByteString)
                 (fromMaybe 0 (cid :: Maybe Word256))
                 (tr :: Integer)
                 (ts :: Integer)
                 (tv :: Word8)
                 (M.toList <$> md)
                 bn
                 h
                 o)
               next)
    parseJSON _ = error "bad param when calling parseJSON for RawTransaction'"

rtToRtPrime :: (String , RawTransaction) -> RawTransaction'
rtToRtPrime (s, x) = RawTransaction' x s

rtToRtPrime' :: RawTransaction -> RawTransaction'
rtToRtPrime' x = RawTransaction' x ""

rtPrimeToRt :: RawTransaction' -> RawTransaction
rtPrimeToRt (RawTransaction' x _) = x

data Transaction' = Transaction' Transaction deriving (Eq, Show)

instance ToJSON Transaction' where
    toJSON (Transaction' tx@(MessageTX tnon tgp tgl (Address tto) tval td tcid tr ts tv md)) =
        object $ ["kind" .= ("Transaction" :: String),
                  "from" .= ((uncurry showHex) $ ((fromMaybe (Address 0) (whoSignedThisTransaction tx)),"")),
                  "nonce" .= tnon,
                  "gasPrice" .= tgp,
                  "gasLimit" .= tgl,
                  "to" .= showHex tto "",
                  "value" .= tval,
                  "data" .= td,
                  "r" .= showHex tr "",
                  "s" .= showHex ts "",
                  "v" .= showHex tv "",
                  "hash" .= transactionHash tx,
                  "transactionType" .= (show $ transactionSemantics $ tx)]
                 ++ (("chainId" .=) <$> (maybeToList tcid))
                 ++ (("metadata" .=) <$> maybeToList md)
    toJSON (Transaction' tx@(ContractCreationTX tnon tgp tgl tval tcode tcid tr ts tv md)) =
        object $ ["kind" .= ("Transaction" :: String),
                  "from" .= ((uncurry showHex) $ ((fromMaybe (Address 0) (whoSignedThisTransaction tx)),"")),
                  "nonce" .= tnon,
                  "gasPrice" .= tgp,
                  "gasLimit" .= tgl,
                  "value" .= tval,
                  "init" .= tcode,
                  "r" .= showHex tr "",
                  "s" .= showHex ts "",
                  "v" .= showHex tv "",
                  "hash" .= transactionHash tx,
                  "transactionType" .= (show $ transactionSemantics $ tx)]
                 ++ (("chainId" .=) <$> (maybeToList tcid))
                 ++ (("metadata" .=) <$> maybeToList md)
    toJSON (Transaction' tx@(PrivateHashTX th tch)) =
        object ["r" .= showHex th "",
                "s" .= showHex tch "",
                "transactionType" .= (show $ transactionSemantics $ tx)]


instance FromJSON Transaction' where
    parseJSON (Object t) = do
      th <- (t .:? "transactionHash")
      tch <- (t .:? "chainHash")
      case (th, tch) of
        (Just h, Just ch) -> return (Transaction' (PrivateHashTX h ch))
        _ -> do
          tto <- (t .:? "to")
          tnon <- (t .: "nonce")
          tgp <- (t .: "gasPrice")
          tgl <- (t .: "gasLimit")
          tval <- (t .: "value")
          tcid <- (t .:? "chainId")
          tr <- parseHexStr (t .: "r")
          ts <- parseHexStr (t .: "s")
          tv <- parseHexStr (t .: "v")
          md <- t .:? "metadata"

          case tto of
            Nothing -> do
              (ti :: Code) <- (t .: "init")
              return . Transaction' $ ContractCreationTX tnon tgp tgl tval ti tcid tr ts tv md
            (Just to') -> do
              td <- (t .: "data")
              return . Transaction' $ MessageTX tnon tgp tgl to' tval td tcid tr ts tv md
    parseJSON _ = error "bad param when calling parseJSON for Transaction'"


tToTPrime :: Transaction -> Transaction'
tToTPrime = Transaction'

tPrimeToT :: Transaction' -> Transaction
tPrimeToT (Transaction' tx) = tx

data Block' = Block' Block String deriving (Eq, Show)

instance ToJSON Block' where
      toJSON (Block' (Block bd rt bu) next) =
        object ["next" .= next, "kind" .= ("Block" :: String), "blockData" .= bdToBdPrime bd,
         "receiptTransactions" .= map tToTPrime rt,
         "blockUncles" .= map bdToBdPrime bu]

blockDataRefToBlock::BlockDataRef->[Transaction]->Block
blockDataRefToBlock bdr txs = Block{
  blockBlockData =
     BlockData{
       blockDataParentHash = blockDataRefParentHash bdr,
       blockDataUnclesHash = blockDataRefUnclesHash bdr,
       blockDataCoinbase = blockDataRefCoinbase bdr,
       blockDataStateRoot = blockDataRefStateRoot bdr,
       blockDataTransactionsRoot = blockDataRefTransactionsRoot bdr,
       blockDataReceiptsRoot = blockDataRefReceiptsRoot bdr,
       blockDataLogBloom = blockDataRefLogBloom bdr,
       blockDataDifficulty = blockDataRefDifficulty bdr,
       blockDataNumber = blockDataRefNumber bdr,
       blockDataGasLimit = blockDataRefGasLimit bdr,
       blockDataGasUsed = blockDataRefGasUsed bdr,
       blockDataTimestamp = blockDataRefTimestamp bdr,
       blockDataExtraData = blockDataRefExtraData bdr,
       blockDataNonce = blockDataRefNonce bdr,
       blockDataMixHash = blockDataRefMixHash bdr
       },
  blockReceiptTransactions = txs,
  blockBlockUncles = blockDataRefBlockUncles bdr
  }


bToBPrime :: String -> BlockDataRef -> [Transaction] -> Block'
bToBPrime s x txs = Block' (blockDataRefToBlock x txs) s

bToBPrime' :: BlockDataRef -> [Transaction] -> Block'
bToBPrime' x txs = Block' (blockDataRefToBlock x txs) ""

bPrimeToB :: Block' -> Block
bPrimeToB (Block' x _) = x

data BlockData' = BlockData' BlockData deriving (Eq, Show)

instance ToJSON BlockData' where
      toJSON (BlockData' (BlockData ph uh (Address a) sr tr rr _ d num gl gu ts ed non mh)) =
        object ["kind" .= ("BlockData" :: String), "parentHash" .= ph, "unclesHash" .= uh, "coinbase" .= (showHex a ""), "stateRoot" .= sr,
        "transactionsRoot" .= tr, "receiptsRoot" .= rr, "difficulty" .= d, "number" .= num,
        "gasLimit" .= gl, "gasUsed" .= gu, "timestamp" .= ts, "extraData" .= ed, "nonce" .= non,
        "mixHash" .= mh]

instance FromJSON BlockData' where
    parseJSON = withObject "BlockData'" $ \v -> BlockData' <$> (BlockData
      <$> v .: "parentHash"
      <*> v .: "unclesHash"
      <*> v .: "coinbase"
      <*> v .: "stateRoot"
      <*> v .: "transactionsRoot"
      <*> v .: "receiptsRoot"
      <*> v .:? "logBloom" .!= ""
      <*> v .: "difficulty"
      <*> v .: "number"
      <*> v .: "gasLimit"
      <*> v .: "gasUsed"
      <*> v .: "timestamp"
      <*> v .: "extraData"
      <*> v .: "nonce"
      <*> v .: "mixHash"
      )

instance FromJSON Block' where
    parseJSON = withObject "Block'" $ \v -> (Block'
      <$> (Block
        <$> (bdPrimeToBd <$> (v .: "blockData"))
        <*> (map tPrimeToT <$> (v .: "receiptTransactions"))
        <*> (map bdPrimeToBd <$> (v .: "blockUncles")))
      <*> (v .: "next")
      )

bdToBdPrime :: BlockData -> BlockData'
bdToBdPrime = BlockData'

bdPrimeToBd :: BlockData' -> BlockData
bdPrimeToBd (BlockData' bd) = bd

data BlockDataRef' = BlockDataRef' BlockDataRef deriving (Eq, Show)

instance ToJSON BlockDataRef' where
      toJSON (BlockDataRef' (BlockDataRef ph uh (Address a) sr tr rr _ d num gl gu ts ed non mh h uncles pow isConf td)) =
        object ["parentHash" .= ph, "unclesHash" .= uh, "coinbase" .= (showHex a ""), "stateRoot" .= sr,
        "transactionsRoot" .= tr, "receiptsRoot" .= rr, "difficulty" .= d, "number" .= num,
        "gasLimit" .= gl, "gasUsed" .= gu, "timestamp" .= ts, "extraData" .= ed, "nonce" .= non,
        "mixHash" .= mh, "hash" .= h, "uncles" .= map bdToBdPrime uncles, "powVerified" .= pow, "isConfirmed" .= isConf, "totalDifficulty" .= td]



bdrToBdrPrime :: BlockDataRef -> BlockDataRef'
bdrToBdrPrime = BlockDataRef'

data AddressStateRef' = AddressStateRef' AddressStateRef String deriving (Eq, Show)

instance ToJSON AddressStateRef' where
    toJSON (AddressStateRef' (AddressStateRef (Address x) n b cr c ch cid bNum) next) =
        object $ ["next" .= next, "kind" .= ("AddressStateRef" :: String),
                  "address" .= (showHex x ""), "nonce" .= n, "balance" .= show b,
                  "contractRoot" .= cr, "code" .= c, "codeHash" .= ch,
                  "latestBlockNum" .= bNum]
                  ++ (("chainId" .=) <$> (maybeToList cid))

instance FromJSON AddressStateRef' where
    parseJSON (Object s) = do
      kind <- s .: "kind"
      if kind /= ("AddressStateRef" :: String)
        then fail "JSON is not AddressStateRef"
        else asrToAsrPrime' <$>
              (AddressStateRef . Address . fst . head . readHex <$> s .: "address"
                <*> s .: "nonce"
                <*> (read <$> (s .: "balance"))
                <*> s .: "contractRoot"
                <*> s .: "code"
                <*> s .: "codeHash"
                <*> s .:? "chainId"
                <*> s .: "latestBlockNum"
              )
    parseJSON _ = fail "JSON not an object"

showHexSimple :: (Show a, Integral a) => a -> String
showHexSimple t = showHex t ""

instance ToJSON LogDB where
    toJSON (LogDB bh th
                  chainId
                  (Address x)
                  maybeTopic1
                  maybeTopic2
                  maybeTopic3
                  maybeTopic4
                  dataBS
                  bloomW512) =
        object $ ["hash" .= th,
                "blockHash" .= bh,
                "address" .= (showHex x ""),
                "topic1" .= (maybe "" showHexSimple maybeTopic1 :: String),
                "topic2" .= (maybe "" showHexSimple maybeTopic2 :: String),
                "topic3" .= (maybe "" showHexSimple maybeTopic3 :: String),
                "topic4" .= (maybe "" showHexSimple maybeTopic4 :: String),

                "data" .= dataBS,
                "bloom" .= showHexSimple bloomW512 ]
                ++ (("chainid" .=) <$> maybeToList chainId)

asrToAsrPrime :: (String, AddressStateRef) -> AddressStateRef'
asrToAsrPrime (s, x) = AddressStateRef' x s

asrToAsrPrime' :: AddressStateRef -> AddressStateRef'
asrToAsrPrime' x = AddressStateRef' x ""

data Address' = Address' Address String deriving (Eq, Show)

adToAdPrime :: Address -> Address'
adToAdPrime x = Address' x ""

--instance ToJSON Address' where
--  toJSON (Address' x) = object [ "address" .= (showHex x "") ]

data TransactionType = Contract | FunctionCall | Transfer  deriving (Eq, Show)

--instance ToJSON TransactionType where
--   toJSON x = object ["transactionType" .= show x]

transactionSemantics :: Transaction -> TransactionType
transactionSemantics (MessageTX _ _ _ (Address _) _ td _ _ _ _ _) = work
    where work | (B.length td) > 0 = FunctionCall
               | otherwise = Transfer
transactionSemantics _ = Contract

isAddr :: Maybe Address -> Bool
isAddr a = case a of
      Just _  -> True
      Nothing -> False

rawTransactionSemantics :: RawTransaction -> TransactionType
rawTransactionSemantics (RawTransaction _ _ _ _ _ ta _ cod _ _ _ _ _ _ _ _) = work
     where work | (not (isAddr ta))  = Contract
                | (isAddr ta) &&  ((B.length cod) > 0)        = FunctionCall
                | otherwise = Transfer
