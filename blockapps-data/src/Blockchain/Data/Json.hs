{-# LANGUAGE DeriveGeneric       #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}

--TODO : Take this next line out
{-# OPTIONS_GHC -fno-warn-orphans #-}


module Blockchain.Data.Json where

import           Blockchain.Data.Address
import           Blockchain.Data.Code
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Transaction
import           Blockchain.Format

import           Data.Aeson
import           Data.Aeson.Types            (Parser)
import qualified Data.ByteString             as B
import qualified Data.ByteString.Base16      as B16
import           Data.Maybe
import qualified Data.Text.Encoding          as T
import           Data.Time.Calendar
import           Data.Time.Clock
import           Data.Word
import           GHC.Generics
import           Numeric
import           Text.Read

jsonBlk :: (ToJSON a, Monad m) => a -> m Value
jsonBlk = return . toJSON

data RawTransaction' = RawTransaction' RawTransaction String deriving (Eq, Show, Generic)

{- fix these later -}
-- instance FromJSON Code
-- instance ToJSON Code

{- note we keep the file MiscJSON around for the instances we don't want to export - ByteString, Point -}

instance ToJSON RawTransaction' where
    toJSON (RawTransaction' rt@(RawTransaction t (Address fa) non gp gl (Just (Address ta)) val cod r s v bn h o) next) =
        object ["next" .= next, "from" .= showHex fa "", "nonce" .= non, "gasPrice" .= gp, "gasLimit" .= gl,
        "to" .= showHex ta "" , "value" .= show val, "codeOrData" .= cod,
        "r" .= showHex r "",
        "s" .= showHex s "",
        "v" .= showHex v "",
        "blockNumber" .= bn,
        "hash" .= h,
        "transactionType" .= (show $ rawTransactionSemantics rt),
        "timestamp" .= show t,
        "origin" .= format o
               ]
    toJSON (RawTransaction' rt@(RawTransaction t (Address fa) non gp gl Nothing val cod r s v bn h o) next) =
        object ["next" .= next, "from" .= showHex fa "", "nonce" .= non, "gasPrice" .= gp, "gasLimit" .= gl,
        "value" .= show val, "codeOrData" .= cod,
        "r" .= showHex r "",
        "s" .= showHex s "",
        "v" .= showHex v "",
        "blockNumber" .= bn,
        "hash" .= h,
        "transactionType" .= (show $ rawTransactionSemantics rt),
        "timestamp" .= show t,
        "origin" .= format o
               ]

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
      (tr :: Integer) <- parseHexStr (t .: "r")
      (ts :: Integer) <- parseHexStr (t .: "s")
      (tv :: Word8) <- parseHexStr (t .: "v")
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
                 (tr :: Integer)
                 (ts :: Integer)
                 (tv :: Word8)
                 bn
                 h
                 o)
               next)
    parseJSON _ = error "bad param when calling parseJSON for RawTransaction'"

instance ToJSON RawTransaction where
    toJSON rt@(RawTransaction t (Address fa) non gp gl (Just (Address ta)) val cod r s v bn h o) =
        object ["from" .= showHex fa "", "nonce" .= non, "gasPrice" .= gp, "gasLimit" .= gl,
        "to" .= showHex ta "" , "value" .= show val, "codeOrData" .= cod,
        "r" .= showHex r "",
        "s" .= showHex s "",
        "v" .= showHex v "",
        "blockNumber" .= bn,
        "hash" .= h,
        "transactionType" .= (show $ rawTransactionSemantics rt),
        "timestamp" .= t,
        "origin" .= format o
               ]
    toJSON rt@(RawTransaction t (Address fa) non gp gl Nothing val cod r s v bn h o) =
        object ["from" .= showHex fa "", "nonce" .= non, "gasPrice" .= gp, "gasLimit" .= gl,
        "value" .= show val, "codeOrData" .= cod,
        "r" .= showHex r "",
        "s" .= showHex s "",
        "v" .= showHex v "",
        "blockNumber" .= bn,
        "hash" .= h,
        "transactionType" .= (show $ rawTransactionSemantics rt),
        "timestamp" .= t,
        "origin" .= format o
               ]

instance FromJSON RawTransaction where
    parseJSON (Object t) = do
      fa <- parseHexStr (t .: "from")
      (tnon :: Int)  <- (t .: "nonce")
      (tgp :: Int) <- (t .: "gasPrice")
      (tgl :: Int) <- (t .: "gasLimit")
      tto <- (t .:? "to")
      let toFld = case tto of
            (Just str) -> fmap (Address . fst . head . readHex) str
            Nothing    -> Nothing
      tval <- fmap read (t .: "value")
      tcd <- fmap (fst .  B16.decode . T.encodeUtf8 ) (t .: "codeOrData")
      (tr :: Integer) <- parseHexStr (t .: "r")
      (ts :: Integer) <- parseHexStr (t .: "s")
      (tv :: Word8) <- parseHexStr (t .: "v")
      mbn <- (t .:? "blockNumber")
      h <- (t .: "hash")
      time <- t .:? "timestamp" .!= UTCTime (fromGregorian 1982 11 24) (secondsToDiffTime 0)
      o <- t .: "origin"
      let bn = case mbn of
            Just b  -> b
            Nothing -> -1

      return (RawTransaction time (Address fa)
                                              (fromIntegral tnon :: Integer)
                                              (fromIntegral $ tgp :: Integer)
                                              (fromIntegral $ tgl :: Integer)
                                              (toFld :: Maybe Address)
                                              (tval :: Integer)
                                              (tcd :: B.ByteString)
                                              (tr :: Integer)
                                              (ts :: Integer)
                                              (tv :: Word8)
                                              bn
                                              h
                                              o)
    parseJSON _ = error "bad param when calling parseJSON for RawTransaction"

rtToRtPrime :: (String , RawTransaction) -> RawTransaction'
rtToRtPrime (s, x) = RawTransaction' x s

rtToRtPrime' :: RawTransaction -> RawTransaction'
rtToRtPrime' x = RawTransaction' x ""

data Transaction' = Transaction' Transaction deriving (Eq, Show)

instance ToJSON Transaction' where
    toJSON (Transaction' tx@(MessageTX tnon tgp tgl (Address tto) tval td tr ts tv)) =
        object ["kind" .= ("Transaction" :: String),
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
    toJSON (Transaction' (ContractCreationTX _ _ _ _ (PrecompiledCode _) _ _ _)) = error "error in ToJSON for Transaction': You can't serialize a precompiled code"
    toJSON (Transaction' tx@(ContractCreationTX tnon tgp tgl tval (Code ti) tr ts tv)) =
        object ["kind" .= ("Transaction" :: String),
                "from" .= ((uncurry showHex) $ ((fromMaybe (Address 0) (whoSignedThisTransaction tx)),"")),
                "nonce" .= tnon,
                "gasPrice" .= tgp,
                "gasLimit" .= tgl,
                "value" .= tval,
                "init" .= ti,
                "r" .= showHex tr "",
                "s" .= showHex ts "",
                "v" .= showHex tv "",
                "hash" .= transactionHash tx,
                "transactionType" .= (show $ transactionSemantics $ tx)]

{-- needs to be updated --}
-- Needs "from", "hash", and "init" for Contract transactions
instance FromJSON Transaction' where
    parseJSON (Object t) = do
      tto <- (t .:? "to")
      tnon <- (t .: "nonce")
      tgp <- (t .: "gasPrice")
      tgl <- (t .: "gasLimit")
      tval <- (t .: "value")
      tr <- parseHexStr (t .: "r")
      ts <- parseHexStr (t .: "s")
      tv <- parseHexStr (t .: "v")

      case tto of
        Nothing -> do
          ti <- (t .: "init")
          return (Transaction' (ContractCreationTX tnon tgp tgl tval ti tr ts tv))
        (Just to') -> do
          td <- (t .: "data")
          return (Transaction' (MessageTX tnon tgp tgl to' tval td tr ts tv))
    parseJSON _ = error "bad param when calling parseJSON for Transaction'"


instance ToJSON Transaction where
    toJSON (tx@(MessageTX tnon tgp tgl (Address tto) tval td tr ts tv)) =
        object ["kind" .= ("Transaction" :: String),
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
    toJSON (ContractCreationTX _ _ _ _ (PrecompiledCode _) _ _ _) = error "error in ToJSON for Transaction: You can't serialize a precompiled code"
    toJSON (tx@(ContractCreationTX tnon tgp tgl tval (Code ti) tr ts tv)) =
        object ["kind" .= ("Transaction" :: String),
                "from" .= ((uncurry showHex) $ ((fromMaybe (Address 0) (whoSignedThisTransaction tx)),"")),
                "nonce" .= tnon,
                "gasPrice" .= tgp,
                "gasLimit" .= tgl,
                "value" .= tval,
                "init" .= ti,
                "r" .= showHex tr "",
                "s" .= showHex ts "",
                "v" .= showHex tv "",
                "hash" .= transactionHash tx,
                "transactionType" .= (show $ transactionSemantics $ tx)]

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

      --TODO- check if this next case is needed
      --toJSON _ = object ["malformed Block" .= True]

instance ToJSON Block where
      toJSON (Block bd rt bu) =
        object ["kind" .= ("Block" :: String), "blockData" .= bdToBdPrime bd,
         "receiptTransactions" .= map tToTPrime rt,
         "blockUncles" .= map bdToBdPrime bu]

      --TODO- check if this next case is needed
      --toJSON _ = object ["malformed Block" .= True]

   

bToBPrime :: (String , Block) -> Block'
bToBPrime (s, x) = Block' x s

bToBPrime' :: Block -> Block'
bToBPrime' x = Block' x ""

data BlockData' = BlockData' BlockData deriving (Eq, Show)

instance ToJSON BlockData' where
      toJSON (BlockData' (BlockData ph uh (Address a) sr tr rr _ d num gl gu ts ed non mh)) =
        object ["kind" .= ("BlockData" :: String), "parentHash" .= ph, "unclesHash" .= uh, "coinbase" .= (showHex a ""), "stateRoot" .= sr,
        "transactionsRoot" .= tr, "receiptsRoot" .= rr, "difficulty" .= d, "number" .= num,
        "gasLimit" .= gl, "gasUsed" .= gu, "timestamp" .= ts, "extraData" .= ed, "nonce" .= non,
        "mixHash" .= mh]

      --TODO- check if this next case is needed
      --toJSON _ = object ["malformed BlockData" .= True]

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
      toJSON (BlockDataRef' (BlockDataRef ph uh (Address a) sr tr rr _ d num gl gu ts ed non mh bi h pow isConf td)) =
        object ["parentHash" .= ph, "unclesHash" .= uh, "coinbase" .= (showHex a ""), "stateRoot" .= sr,
        "transactionsRoot" .= tr, "receiptsRoot" .= rr, "difficulty" .= d, "number" .= num,
        "gasLimit" .= gl, "gasUsed" .= gu, "timestamp" .= ts, "extraData" .= ed, "nonce" .= non,
        "mixHash" .= mh, "blockId" .= bi, "hash" .= h, "powVerified" .= pow, "isConfirmed" .= isConf, "totalDifficulty" .= td]



bdrToBdrPrime :: BlockDataRef -> BlockDataRef'
bdrToBdrPrime = BlockDataRef'

data AddressStateRef' = AddressStateRef' AddressStateRef String deriving (Eq, Show)

instance ToJSON AddressStateRef' where
    toJSON (AddressStateRef' (AddressStateRef (Address x) n b cr c ch bNum src) next) =
        object ["next" .= next, "kind" .= ("AddressStateRef" :: String), "address" .= (showHex x ""), "nonce" .= n, "balance" .= show b,
        "contractRoot" .= cr, "code" .= c, "codeHash" .= ch, "latestBlockNum" .= bNum, "source" .= src]

instance ToJSON AddressStateRef where
    toJSON (AddressStateRef (Address x) n b cr c ch bNum src) =
        object ["kind" .= ("AddressStateRef" :: String), "address" .= (showHex x ""), "nonce" .= n, "balance" .= show b,
        "contractRoot" .= cr, "code" .= c, "codeHash" .= ch, "latestBlockNum" .= bNum, "source" .= src]

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
                <*> s .: "latestBlockNum"
                <*> s .: "source"
              )
    parseJSON _ = fail "JSON not an object"

showHexSimple :: (Show a, Integral a) => a -> String
showHexSimple t = showHex t ""

instance ToJSON LogDB where
    toJSON (LogDB bh th
                  (Address x)
                  maybeTopic1
                  maybeTopic2
                  maybeTopic3
                  maybeTopic4
                  dataBS
                  bloomW512) =
        object ["hash" .= th,
                "blockHash" .= bh,
                "address" .= (showHex x ""),
                "topic1" .= (maybe "" showHexSimple maybeTopic1 :: String),
                "topic2" .= (maybe "" showHexSimple maybeTopic2 :: String),
                "topic3" .= (maybe "" showHexSimple maybeTopic3 :: String),
                "topic4" .= (maybe "" showHexSimple maybeTopic4 :: String),

                "data" .= dataBS,
                "bloom" .= showHexSimple bloomW512 ]

{-
Not needed yet.

instance FromJSON LogDB where
    parseJSON (Object s) = do

    parseJSON _ = fail "malformed log"
-}

asrToAsrPrime :: (String, AddressStateRef) -> AddressStateRef'
asrToAsrPrime (s, x) = AddressStateRef' x s

asrToAsrPrime' :: AddressStateRef -> AddressStateRef'
asrToAsrPrime' x = AddressStateRef' x ""

--jsonFix x@(AddressStateRef a b c d e) = AddressStateRef' x
--jsonFix x@(BlockDataRef a b c d e f g h i j k l m n o p q) = BlockDataRef' x

data Address' = Address' Address String deriving (Eq, Show)

adToAdPrime :: Address -> Address'
adToAdPrime x = Address' x ""

--instance ToJSON Address' where
--  toJSON (Address' x) = object [ "address" .= (showHex x "") ]

data TransactionType = Contract | FunctionCall | Transfer  deriving (Eq, Show)

--instance ToJSON TransactionType where
--   toJSON x = object ["transactionType" .= show x]

transactionSemantics :: Transaction -> TransactionType
transactionSemantics (MessageTX _ _ _ (Address _) _ td _ _ _) = work
    where work | (B.length td) > 0 = FunctionCall
               | otherwise = Transfer
transactionSemantics _ = Contract

isAddr :: Maybe Address -> Bool
isAddr a = case a of
      Just _  -> True
      Nothing -> False

rawTransactionSemantics :: RawTransaction -> TransactionType
rawTransactionSemantics (RawTransaction _ _ _ _ _ ta _ cod _ _ _ _ _ _) = work
     where work | (not (isAddr ta))  = Contract
                | (isAddr ta) &&  ((B.length cod) > 0)        = FunctionCall
                | otherwise = Transfer
