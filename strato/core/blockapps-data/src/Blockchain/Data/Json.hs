{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
--TODO : Take this next line out
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.Json where

import BlockApps.X509
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.DataDefs
import Blockchain.Data.TXOrigin
import Blockchain.Data.Transaction
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Class (blockHeaderHash, DummyCertRevocation(..))
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord (Word256, word256ToBytes)
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Control.DeepSeq
import Control.Monad (join)
import Data.Aeson
import Data.Aeson.Types (Parser)
import qualified Data.ByteString as B
import qualified Data.Map.Strict as M
import Data.Maybe
import Data.Swagger hiding (format)
import Data.Text.Encoding (encodeUtf8)
import Data.Time.Calendar
import Data.Time.Clock
import Data.Word
import GHC.Generics
import qualified LabeledError
import Numeric

jsonBlk :: (ToJSON a, Monad m) => a -> m Value
jsonBlk = return . toJSON

data RawTransaction' = RawTransaction' RawTransaction String deriving (Eq, Show, Generic)

data UnsignedRawTransaction' = UnsignedRawTransaction' RawTransaction deriving (Eq, Show, Generic)

{- note we keep the file MiscJSON around for the instances we don't want to export - ByteString, Point -}

instance NFData RawTransaction'

instance ToSchema RawTransaction' where
  declareNamedSchema _ =
    return $
      NamedSchema (Just "RawTransaction'") mempty

instance ToJSON RawTransaction' where
  toJSON (RawTransaction' rt@(RawTransaction t fa non gp gl (Just ta) val cod cName cpa cid r s v md bn h o) next) =
    object $
      [ "next" .= next,
        "from" .= fa,
        "nonce" .= non,
        "gasPrice" .= gp,
        "gasLimit" .= gl,
        "to" .= ta,
        "value" .= show val,
        "codeOrData" .= cod,
        "cName".= cName,
        "cpa".= cpa,
        "r" .= showHex r "",
        "s" .= showHex s "",
        "v" .= showHex v "",
        "blockNumber" .= bn,
        "hash" .= h,
        "transactionType" .= (show $ rawTransactionSemantics rt),
        "timestamp" .= t,
        "origin" .= o
      ]
        ++ (("chainId" .=) <$> maybeToList (ChainId <$> if (0 == cid) then Nothing else Just cid))
        ++ (("metadata" .=) <$> maybeToList (M.fromList <$> md))
  toJSON (RawTransaction' rt@(RawTransaction t fa non gp gl Nothing val cod cName cpa cid r s v md bn h o) next) =
    object $
      [ "next" .= next,
        "from" .= fa,
        "nonce" .= non,
        "gasPrice" .= gp,
        "gasLimit" .= gl,
        "value" .= show val,
        "codeOrData" .= cod,
        "cName".= cName,
        "cpa".= cpa,
        "r" .= showHex r "",
        "s" .= showHex s "",
        "v" .= showHex v "",
        "blockNumber" .= bn,
        "hash" .= h,
        "transactionType" .= (show $ rawTransactionSemantics rt),
        "timestamp" .= t,
        "origin" .= o
      ]
        ++ (("chainId" .=) <$> maybeToList (ChainId <$> if (0 == cid) then Nothing else Just cid))
        ++ (("metadata" .=) <$> maybeToList (M.fromList <$> md))

parseHexStr :: (Integral a) => Parser String -> Parser a
parseHexStr = fmap readHexStr

readHexStr :: Integral a => String -> a
readHexStr = fst . head . readHex

instance FromJSON RawTransaction' where
  parseJSON (Object t) = do
    fa <- t .:? "from" .!= (Address 0)
    tnon <- t .:? "nonce" .!= 0
    tgp <- t .:? "gasPrice" .!= 0
    tgl <- t .:? "gasLimit" .!= 0
    tto <- t .:? "to"
    tval <- LabeledError.read "FromJSON/RawTransaction'" <$> t .:? "value" .!= "0"
    tcd <- t .:? "codeOrData"
    cName <- t .:? "cName" 
    cpa <- t .:? "cpa"
    cid <- fmap (\(ChainId c) -> c) <$> (t .:? "chainId")
    (tr :: Integer) <- parseHexStr (t .: "r")
    (ts :: Integer) <- parseHexStr (t .: "s")
    (tv :: Word8) <- parseHexStr (t .:? "v" .!= "0")
    md <- t .:? "metadata"
    bn <- t .:? "blockNumber" .!= (-1)
    h <- (t .:? "hash" .!= (unsafeCreateKeccak256FromWord256 $ fromIntegral tr)) -- when transaction is PrivateHashTX
    -- Unfortunately, time is rendered with `show` in ToJSON for RawTransaction'
    -- instead of using the ToJSON instance for UTCTime, and so it fails
    -- to parse in FromJSON for UTCTime.
    let defaultTime = UTCTime (fromGregorian 1982 11 24) (secondsToDiffTime 0)
    time <- t .:? "timestamp" .!= defaultTime
    o <- t .:? "origin" .!= API
    next <- t .:? "next" .!= ""

    return
      ( RawTransaction'
          ( RawTransaction
              time
              fa
              (tnon :: Integer)
              (tgp :: Integer)
              (tgl :: Integer)
              (tto :: Maybe Address)
              (tval :: Integer)
              (tcd :: Maybe B.ByteString)
              (cName :: Maybe String)
              (cpa :: Maybe Address)
              (fromMaybe 0 (cid :: Maybe Word256))
              (tr :: Integer)
              (ts :: Integer)
              (tv :: Word8)
              (M.toList <$> md)
              bn
              h
              o
          )
          next
      )
  parseJSON _ = error "bad param when calling parseJSON for RawTransaction'"

instance ToSchema UnsignedRawTransaction' where
  declareNamedSchema _ =
    return $
      NamedSchema (Just "UnsignedRawTransaction'") mempty

instance ToJSON UnsignedRawTransaction' where
  toJSON (UnsignedRawTransaction' (RawTransaction _ _ non gp gl (Just ta) val cod cname cpa cid _ _ _ md _ _ _)) =
    object $
      [ "nonce" .= non,
        "gasPrice" .= gp,
        "gasLimit" .= gl,
        "to" .= ta,
        "value" .= show val,
        "codeOrData" .= cod,
        "contractName" .= cname,
        "codePtrAddress" .= cpa
      ]
        ++ (("chainId" .=) <$> maybeToList (ChainId <$> if (0 == cid) then Nothing else Just cid))
        ++ (("metadata" .=) <$> maybeToList (M.fromList <$> md))
  toJSON (UnsignedRawTransaction' (RawTransaction _ _ non gp gl Nothing val cod cname cpa cid _ _ _ md _ _ _)) =
    object $
      [ "nonce" .= non,
        "gasPrice" .= gp,
        "gasLimit" .= gl,
        "value" .= show val,
        "codeOrData" .= cod,
        "contractName" .= cname,
        "codePtrAddress" .= cpa
      ]
        ++ (("chainId" .=) <$> maybeToList (ChainId <$> if (0 == cid) then Nothing else Just cid))
        ++ (("metadata" .=) <$> maybeToList (M.fromList <$> md))

instance FromJSON UnsignedRawTransaction' where
  parseJSON (Object t) = do
    fa <- t .:? "from" .!= (Address 0)
    tnon <- t .:? "nonce" .!= 0
    tgp <- t .:? "gasPrice" .!= 0
    tgl <- t .:? "gasLimit" .!= 0
    tto <- t .:? "to"
    tval <- LabeledError.read "FromJSON/UnsignedRawTransaction'" <$> t .:? "value" .!= "0"
    tcd <- t .:? "codeOrData" 
    cName <- t .:? "contractName"
    cpa <- t .:? "codePtrAddress"
    cid <- fmap (\(ChainId c) -> c) <$> (t .:? "chainId")
    (tr :: Integer) <- parseHexStr (t .: "r")
    (ts :: Integer) <- parseHexStr (t .: "s")
    (tv :: Word8) <- parseHexStr (t .:? "v" .!= "0")
    md <- t .:? "metadata"
    bn <- t .:? "blockNumber" .!= (-1)
    h <- (t .:? "hash" .!= (unsafeCreateKeccak256FromWord256 $ fromIntegral tr)) -- when transaction is PrivateHashTX
    -- Unfortunately, time is rendered with `show` in ToJSON for UnsignedRawTransaction'
    -- instead of using the ToJSON instance for UTCTime, and so it fails
    -- to parse in FromJSON for UTCTime.
    let defaultTime = UTCTime (fromGregorian 1982 11 24) (secondsToDiffTime 0)
    time <- t .:? "timestamp" .!= defaultTime
    o <- t .:? "origin" .!= API

    return
      ( UnsignedRawTransaction'
          ( RawTransaction
              time
              fa
              (tnon :: Integer)
              (tgp :: Integer)
              (tgl :: Integer)
              (tto :: Maybe Address)
              (tval :: Integer)
              (tcd :: Maybe B.ByteString)
              (cName :: Maybe String)
              (cpa :: Maybe Address)
              (fromMaybe 0 (cid :: Maybe Word256))
              (tr :: Integer)
              (ts :: Integer)
              (tv :: Word8)
              (M.toList <$> md)
              bn
              h
              o
          )
      )
  parseJSON _ = error "bad param when calling parseJSON for RawTransaction'"

rtToRtPrime :: (String, RawTransaction) -> RawTransaction'
rtToRtPrime (s, x) = RawTransaction' x s

rtToRtPrime' :: RawTransaction -> RawTransaction'
rtToRtPrime' x = RawTransaction' x ""

rtPrimeToRt :: RawTransaction' -> RawTransaction
rtPrimeToRt (RawTransaction' x _) = x

data Transaction' = Transaction' Transaction deriving (Eq, Show)

instance ToJSON Transaction' where
  toJSON (Transaction' tx@(MessageTX tnon tgp tgl (Address tto) tval td tcid tr ts tv md)) =
    object $
      [ "kind" .= ("Transaction" :: String),
        "from" .= fromMaybe (Address 0) (whoSignedThisTransaction tx),
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
        "transactionType" .= (show $ transactionSemantics $ tx)
      ]
        ++ (("chainId" .=) <$> (maybeToList tcid))
        ++ (("metadata" .=) <$> maybeToList md)
  toJSON (Transaction' tx@(ContractCreationTX tnon tgp tgl tval tcode tcid tr ts tv md)) =
    object $
      [ "kind" .= ("Transaction" :: String),
        "from" .= fromMaybe (Address 0) (whoSignedThisTransaction tx),
        "nonce" .= tnon,
        "gasPrice" .= tgp,
        "gasLimit" .= tgl,
        "value" .= tval,
        "init" .= tcode,
        "r" .= showHex tr "",
        "s" .= showHex ts "",
        "v" .= showHex tv "",
        "hash" .= transactionHash tx,
        "transactionType" .= (show $ transactionSemantics $ tx)
      ]
        ++ (("chainId" .=) <$> (maybeToList tcid))
        ++ (("metadata" .=) <$> maybeToList md)
  toJSON (Transaction' tx@(PrivateHashTX th tch)) =
    object
      [ "transactionHash" .= showHex (keccak256ToWord256 th) "",
        "chainHash" .= showHex (keccak256ToWord256 tch) "",
        "transactionType" .= (show $ transactionSemantics $ tx)
      ]

instance FromJSON Transaction' where
  parseJSON (Object t) = do
    th <- (t .:? "transactionHash")
    tch <- (t .:? "chainHash")
    case (th, tch) of
      (Just h, Just ch) -> return (Transaction' (PrivateHashTX (unsafeCreateKeccak256FromWord256 $ readHexStr h) (unsafeCreateKeccak256FromWord256 $ readHexStr ch)))
      _ -> do
        tto <- (t .:? "to")
        tnon <- (t .:? "nonce" .!= 0)
        tgp <- (t .:? "gasPrice" .!= 0)
        tgl <- (t .:? "gasLimit" .!= 0)
        tval <- (t .:? "value" .!= 0)
        tcid <- (t .:? "chainId")
        tr <- parseHexStr (t .: "r")
        ts <- parseHexStr (t .: "s")
        tv <- parseHexStr (t .:? "v" .!= "0")
        md <- t .:? "metadata"

        case tto of
          Nothing -> do
            (mti :: Maybe Code) <- (t .:? "init")
            case mti of
              Nothing -> return . Transaction' $ PrivateHashTX (unsafeCreateKeccak256FromWord256 $ fromInteger tr) (unsafeCreateKeccak256FromWord256 $ fromInteger ts)
              Just ti -> return . Transaction' $ ContractCreationTX tnon tgp tgl tval ti tcid tr ts tv md
          (Just to') -> do
            td <- (t .: "data")
            return . Transaction' $ MessageTX tnon tgp tgl to' tval td tcid tr ts tv md
  parseJSON _ = error "bad param when calling parseJSON for Transaction'"

tToTPrime :: Transaction -> Transaction'
tToTPrime = Transaction'

tPrimeToT :: Transaction' -> Transaction
tPrimeToT (Transaction' tx) = tx

data Block' = Block' Block String deriving (Eq, Show)

instance ToSchema Block' where
  declareNamedSchema _ =
    return $
      NamedSchema (Just "Block'") mempty

instance ToJSON Block' where
  toJSON (Block' (Block bd rt bu) next) =
    object
      [ "next" .= next,
        "kind" .= ("Block" :: String),
        "blockData" .= bdToBdPrime bd,
        "receiptTransactions" .= map tToTPrime rt,
        "blockUncles" .= map bdToBdPrime bu,
        "blockHash" .= blockHeaderHash bd
      ]

blockDataRefToBlock :: BlockDataRef ->
                       [BlockValidatorRef] ->
                       [ValidatorDeltaRef] ->
                       [CertificateAddedRef] ->
                       [CertificateRevokedRef] ->
                       [ProposalSignatureRef] ->
                       [CommitmentSignatureRef] ->
                       [Transaction] ->
                       Block
blockDataRefToBlock bdr vs vd ca cr ps sigs txs = case vs of
  [] -> -- this is a v1 block
    Block
      { blockBlockData =
          BlockHeader
            { parentHash = blockDataRefParentHash bdr,
              ommersHash = blockDataRefUnclesHash bdr,
              beneficiary = CommonName "" "" (blockDataRefCoinbase bdr) True,
              stateRoot = blockDataRefStateRoot bdr,
              transactionsRoot = blockDataRefTransactionsRoot bdr,
              receiptsRoot = blockDataRefReceiptsRoot bdr,
              logsBloom = blockDataRefLogBloom bdr,
              difficulty = blockDataRefDifficulty bdr,
              number = blockDataRefNumber bdr,
              gasLimit = blockDataRefGasLimit bdr,
              gasUsed = blockDataRefGasUsed bdr,
              timestamp = blockDataRefTimestamp bdr,
              extraData = blockDataRefExtraData bdr,
              nonce = blockDataRefNonce bdr,
              mixHash = blockDataRefMixHash bdr
            },
        blockReceiptTransactions = txs,
        blockBlockUncles = []
      }
  _ ->
    Block
      { blockBlockData =
          BlockHeaderV2
            { parentHash = blockDataRefParentHash bdr,
              stateRoot = blockDataRefStateRoot bdr,
              transactionsRoot = blockDataRefTransactionsRoot bdr,
              receiptsRoot = blockDataRefReceiptsRoot bdr,
              logsBloom = blockDataRefLogBloom bdr,
              number = blockDataRefNumber bdr,
              timestamp = blockDataRefTimestamp bdr,
              extraData = blockDataRefExtraData bdr,
              currentValidators = bvr2v <$> vs,
              newValidators = catMaybes $ vdr2v True <$> vd,
              removedValidators = catMaybes $ vdr2v False <$> vd,
              newCerts = catMaybes $ car2x509 <$> ca,
              revokedCerts = crr2dcr <$> cr,
              proposalSignature = join . listToMaybe $ psr2s <$> ps,
              signatures = catMaybes $ csr2s <$> sigs
            },
        blockReceiptTransactions = txs,
        blockBlockUncles = []
      }

bPrimeToB :: Block' -> Block
bPrimeToB (Block' x _) = x

data BlockData' = BlockData' BlockHeader deriving (Eq, Show)

instance ToJSON BlockData' where
  toJSON (BlockData' (BlockHeader ph uh a sr tr rr _ d num gl gu ts ed mh non)) =
    object
      [ "kind" .= ("BlockData" :: String),
        "parentHash" .= ph,
        "unclesHash" .= uh,
        "coinbase" .= a,
        "stateRoot" .= sr,
        "transactionsRoot" .= tr,
        "receiptsRoot" .= rr,
        "difficulty" .= d,
        "number" .= num,
        "gasLimit" .= gl,
        "gasUsed" .= gu,
        "timestamp" .= ts,
        "extraData" .= ed,
        "nonce" .= non,
        "mixHash" .= mh
      ]

  toJSON (BlockData' (BlockHeaderV2{..})) = 
    object
      [ "kind" .= ("BlockData" :: String),
        "parentHash" .= parentHash,
        "stateRoot" .= stateRoot,
        "transactionsRoot" .= transactionsRoot,
        "receiptsRoot" .= receiptsRoot,
        "number" .= number,
        "timestamp" .= timestamp,
        "extraData" .= extraData,
        "currentValidators" .= currentValidators,
        "newValidators" .= newValidators,
        "removedValidators" .= removedValidators,
        "newCerts" .= newCerts,
        "revokedCerts" .= revokedCerts,
        "proposalSignature" .= proposalSignature,
        "signatures" .= signatures
      ]

instance FromJSON BlockData' where
  parseJSON = withObject "BlockData'" $ \v ->
    BlockData'
      <$> ( BlockHeader
              <$> v .: "parentHash"
              <*> v .: "unclesHash"
              <*> v .: "coinbase"
              <*> v .: "stateRoot"
              <*> v .: "transactionsRoot"
              <*> v .: "receiptsRoot"
              <*> v .:? "logBloom" .!= (B.replicate 64 0x30) -- this is what log blooms currently get set to
              <*> v .: "difficulty"
              <*> v .: "number"
              <*> v .: "gasLimit"
              <*> v .: "gasUsed"
              <*> v .: "timestamp"
              <*> v .: "extraData"
              <*> v .: "mixHash"
              <*> v .: "nonce"
          )

instance FromJSON Block' where
  parseJSON = withObject "Block'" $ \v -> do
    bData <- bdPrimeToBd <$> v .: "blockData"
    bTxs <- map tPrimeToT <$> (v .: "receiptTransactions")
    bUncles <- map bdPrimeToBd <$> (v .: "blockUncles")
    next <- v .: "next"
    pure $ Block' (Block bData bTxs bUncles) next

bdToBdPrime :: BlockHeader -> BlockData'
bdToBdPrime = BlockData'

bdPrimeToBd :: BlockData' -> BlockHeader
bdPrimeToBd (BlockData' bd) = bd

data BlockDataRef' = BlockDataRef' BlockDataRef deriving (Eq, Show)

instance ToJSON BlockDataRef' where
  toJSON (BlockDataRef' (BlockDataRef ph uh cc sr tr rr _ d num gl gu ts ed non mh h pow isConf v)) =
    object
      [ "parentHash" .= ph,
        "unclesHash" .= uh,
        "coinbaseCommonName" .= cc,
        "stateRoot" .= sr,
        "transactionsRoot" .= tr,
        "receiptsRoot" .= rr,
        "difficulty" .= d,
        "number" .= num,
        "gasLimit" .= gl,
        "gasUsed" .= gu,
        "timestamp" .= ts,
        "extraData" .= ed,
        "nonce" .= non,
        "mixHash" .= mh,
        "hash" .= h,
        "powVerified" .= pow,
        "isConfirmed" .= isConf,
        "version" .= v
      ]

bdrToBdrPrime :: BlockDataRef -> BlockDataRef'
bdrToBdrPrime = BlockDataRef'

bvr2v :: BlockValidatorRef -> Validator
bvr2v (BlockValidatorRef _ cn) = Validator cn

vdr2v :: Bool -> ValidatorDeltaRef -> Maybe Validator
vdr2v d' (ValidatorDeltaRef _ cn d) | d' == d = Just $ Validator cn
vdr2v _ _ = Nothing

car2x509 :: CertificateAddedRef -> Maybe X509Certificate
car2x509 (CertificateAddedRef _ _ _ cs) =
  either (const Nothing) Just . bsToCert $ encodeUtf8 cs

crr2dcr :: CertificateRevokedRef -> DummyCertRevocation
crr2dcr (CertificateRevokedRef _ ua) = DummyCertRevocation ua

psr2s :: ProposalSignatureRef -> Maybe Signature
psr2s (ProposalSignatureRef _ _ r s v) =
  either (const Nothing) Just . importSignature $
    word256ToBytes r <> word256ToBytes s <> B.singleton v

csr2s :: CommitmentSignatureRef -> Maybe Signature
csr2s (CommitmentSignatureRef _ _ r s v) =
  either (const Nothing) Just . importSignature $
    word256ToBytes r <> word256ToBytes s <> B.singleton v

data AddressStateRef' = AddressStateRef' AddressStateRef String deriving (Eq, Show)

instance ToSchema AddressStateRef' where
  declareNamedSchema _ =
    return $
      NamedSchema (Just "AddresStateRef'") mempty

instance ToJSON AddressStateRef' where
  toJSON (AddressStateRef' (AddressStateRef addr n b cr ch cn cpa cpc cid bNum) next) =
    object $
      [ "next" .= next,
        "kind" .= ("AddressStateRef" :: String),
        "address" .= addr,
        "nonce" .= n,
        "balance" .= show b,
        "contractRoot" .= cr,
        "codeHash" .= ch,
        "contractName" .= cn,
        "codePtrAddress" .= cpa,
        "codePtrChainId" .= cpc,
        "latestBlockNum" .= bNum
      ]
        ++ (("chainId" .=) <$> (if cid == 0 then [] else [cid]))

instance FromJSON AddressStateRef' where
  parseJSON (Object s) = do
    kind <- s .: "kind"
    if kind /= ("AddressStateRef" :: String)
      then fail "JSON is not AddressStateRef"
      else
        asrToAsrPrime'
          <$> ( AddressStateRef . Address . fst . head . readHex <$> s .: "address"
                  <*> s .: "nonce"
                  <*> (LabeledError.read "FromJSON/AddressRef'" <$> (s .: "balance"))
                  <*> s .: "contractRoot"
                  -- <*> s .: "code"
                  <*> s .:? "codeHash"
                  <*> s .:? "contractName"
                  <*> s .:? "codePtrAddress"
                  <*> s .:? "codePtrChainId"
                  <*> s .:? "chainId" .!= 0
                  <*> s .: "latestBlockNum"
              )
  parseJSON _ = fail "JSON not an object"

showHexSimple :: (Integral a) => a -> String
showHexSimple t = showHex t ""

instance ToJSON LogDB where
  toJSON
    ( LogDB
        bh
        th
        chainId
        x
        maybeTopic1
        maybeTopic2
        maybeTopic3
        maybeTopic4
        dataBS
        bloomW512
      ) =
      object $
        [ "hash" .= th,
          "blockHash" .= bh,
          "address" .= x,
          "topic1" .= (maybe "" showHexSimple maybeTopic1 :: String),
          "topic2" .= (maybe "" showHexSimple maybeTopic2 :: String),
          "topic3" .= (maybe "" showHexSimple maybeTopic3 :: String),
          "topic4" .= (maybe "" showHexSimple maybeTopic4 :: String),
          "data" .= dataBS,
          "bloom" .= showHexSimple bloomW512
        ]
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

data TransactionType = Contract | FunctionCall | Transfer deriving (Eq, Show)

--instance ToJSON TransactionType where
--   toJSON x = object ["transactionType" .= show x]

transactionSemantics :: Transaction -> TransactionType
transactionSemantics (MessageTX _ _ _ (Address _) _ td _ _ _ _ _) = work
  where
    work
      | (B.length td) > 0 = FunctionCall
      | otherwise = Transfer
transactionSemantics _ = Contract

isAddr :: Maybe Address -> Bool
isAddr a = case a of
  Just _ -> True
  Nothing -> False

rawTransactionSemantics :: RawTransaction -> TransactionType
rawTransactionSemantics rawtx = work
  where
    work
      | (not (isAddr (rawTransactionToAddress rawtx))) = Contract
      | (isAddr (rawTransactionToAddress rawtx)) && ((B.length cod) > 0) = FunctionCall
      | otherwise = Transfer
    cod = case (rawTransactionCodeOrData rawtx) of
      Just c -> c
      _ -> ""
