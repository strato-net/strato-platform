{-# LANGUAGE DeriveGeneric       #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Blockchain.Model.JsonBlock (
  UnsignedRawTransaction'(..),
  RawTransaction'(..),
  Transaction'(..),
  Block'(..),
  BlockData',
  AddressStateRef'(..),
  tPrimeToT,
  bPrimeToB,
  rtPrimeToRt,
  rtToRtPrime,
  rtToRtPrime',
  blockDataRefToBlock,
  asrToAsrPrime
  ) where

import           Blockchain.Data.Block
import           Blockchain.Data.BlockHeader
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Transaction
import           Blockchain.Data.TXOrigin
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Class        (blockHeaderHash)
import           Blockchain.Strato.Model.ExtendedWord (word256ToBytes)
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Strato.Model.Validator
import           Control.DeepSeq
import           Control.Monad                        (join)
import           Data.Aeson
import           Data.Aeson.Types                     (Parser)
import qualified Data.ByteString                      as B
import           Data.Maybe
import           Data.Swagger                         hiding (format)
import           Data.Time.Calendar
import           Data.Time.Clock
import           Data.Word
import           GHC.Generics
import qualified LabeledError
import           Numeric
{-
jsonBlk :: (ToJSON a, Monad m) => a -> m Value
jsonBlk = return . toJSON
-}
data RawTransaction' = RawTransaction' RawTransaction String deriving (Eq, Show, Generic)

newtype UnsignedRawTransaction' = UnsignedRawTransaction' RawTransaction deriving (Eq, Show, Generic)

{- note we keep the file MiscJSON around for the instances we don't want to export - ByteString, Point -}

instance NFData RawTransaction'

instance ToSchema RawTransaction' where
  declareNamedSchema _ =
    return $
      NamedSchema (Just "RawTransaction'") mempty

instance ToJSON RawTransaction' where
  toJSON (RawTransaction' rt@(RawTransaction{..}) next) =
    object $
      [ "next" .= next,
        "from" .= rawTransactionFromAddress,
        "nonce" .= rawTransactionNonce,
        "gasLimit" .= rawTransactionGasLimit,
        "to" .= rawTransactionToAddress,
        "cName".= rawTransactionContractName,
        "funcName".= rawTransactionFuncName,
        "args".= rawTransactionArgs,
        "network".= rawTransactionNetwork,
        "code".= rawTransactionCode,
        "r" .= showHex rawTransactionR "",
        "s" .= showHex rawTransactionS "",
        "v" .= showHex rawTransactionV "",
        "blockNumber" .= rawTransactionBlockNumber,
        "hash" .= rawTransactionTxHash,
        "transactionType" .= show (rawTransactionSemantics rt),
        "timestamp" .= rawTransactionTimestamp,
        "origin" .= rawTransactionOrigin
      ]

parseHexStr :: (Integral a) => Parser String -> Parser a
parseHexStr = fmap readHexStr

readHexStr :: Integral a => String -> a
readHexStr = fst . head . readHex

instance FromJSON RawTransaction' where
  parseJSON (Object t) = do
    fa <- t .:? "from" .!= Address 0
    nonce <- t .:? "nonce" .!= 0
    gasLimit <- t .:? "gasLimit" .!= 0
    toAddr <- t .:? "to"
    contractName <- t .:? "cName"
    funcName <- t .:? "funcName"
    args <- t .: "args"
    network <- t .: "code"
    code <- t .:? "code"
    (tr :: Integer) <- parseHexStr (t .: "r")
    (ts :: Integer) <- parseHexStr (t .: "s")
    (tv :: Word8) <- parseHexStr (t .:? "v" .!= "0")
    bn <- t .:? "blockNumber" .!= (-1)
    h <- t .:? "hash" .!= unsafeCreateKeccak256FromWord256 (fromIntegral tr) -- when transaction is PrivateHashTX
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
              nonce
              gasLimit
              toAddr
              funcName
              contractName
              args
              network
              code
              (tr :: Integer)
              (ts :: Integer)
              (tv :: Word8)
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
  toJSON (UnsignedRawTransaction' (RawTransaction{..})) =
    object $
      [ "nonce" .= rawTransactionNonce,
        "gasLimit" .= rawTransactionGasLimit,
        "to" .= rawTransactionToAddress,
        "contractName" .= rawTransactionContractName,
        "functionName" .= rawTransactionFuncName,
        "args" .= rawTransactionArgs,
        "network" .= rawTransactionNetwork,
        "code" .= rawTransactionCode
      ]

instance FromJSON UnsignedRawTransaction' where
  parseJSON (Object t) = do
    fa <- t .:? "from" .!= Address 0
    nonce <- t .:? "nonce" .!= 0
    gasLimit <- t .:? "gasLimit" .!= 0
    toAddr <- t .:? "to"
    funcName <- t .:? "funcName"
    contractName <- t .:? "contractName"
    args <- t .: "args"
    network <- t .: "network"
    code <- t .:? "code"
    (tr :: Integer) <- parseHexStr (t .: "r")
    (ts :: Integer) <- parseHexStr (t .: "s")
    (tv :: Word8) <- parseHexStr (t .:? "v" .!= "0")
    bn <- t .:? "blockNumber" .!= (-1)
    h <- t .:? "hash" .!= unsafeCreateKeccak256FromWord256 (fromIntegral tr) -- when transaction is PrivateHashTX
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
              nonce
              gasLimit
              toAddr
              funcName
              contractName
              args
              network
              code
              tr
              ts
              tv
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

newtype Transaction' = Transaction' Transaction deriving (Eq, Show)

instance ToJSON Transaction' where
  toJSON (Transaction' tx@(MessageTX nonce gasLimit (Address toAddr) funcName args network tr ts tv)) =
    object $
      [ "kind" .= ("Transaction" :: String),
        "from" .= fromMaybe (Address 0) (whoSignedThisTransaction tx),
        "nonce" .= nonce,
        "gasLimit" .= gasLimit,
        "to" .= showHex toAddr "",
        "network" .= network,
        "args" .= args,
        "funcName" .= funcName,
        "r" .= showHex tr "",
        "s" .= showHex ts "",
        "v" .= showHex tv "",
        "hash" .= transactionHash tx,
        "transactionType" .= show (transactionSemantics tx)
      ]
  toJSON (Transaction' tx@(ContractCreationTX nonce gasLimit contractName args network code tr ts tv)) =
    object $
      [ "kind" .= ("Transaction" :: String),
        "from" .= fromMaybe (Address 0) (whoSignedThisTransaction tx),
        "nonce" .= nonce,
        "gasLimit" .= gasLimit,
        "init" .= code,
        "network" .= network,
        "args" .= args,
        "contractName" .= contractName,
        "r" .= showHex tr "",
        "s" .= showHex ts "",
        "v" .= showHex tv "",
        "hash" .= transactionHash tx,
        "transactionType" .= show (transactionSemantics tx)
      ]

instance FromJSON Transaction' where
  parseJSON (Object t) = do
        mToAddr <- t .:? "to"
        nonce <- t .:? "nonce" .!= 0
        gasLimit <- t .:? "gasLimit" .!= 0
        args <- t .:? "args" .!= []
        network <- t .:? "network" .!= ""
        funcName <- t .:? "funcName" .!= ""
        contractName <- t .:? "contractName" .!= ""
        tr <- parseHexStr (t .: "r")
        ts <- parseHexStr (t .: "s")
        tv <- parseHexStr (t .:? "v" .!= "0")

        case mToAddr of
          Nothing -> do
            code <- t .: "code"
            return . Transaction' $ ContractCreationTX
              nonce gasLimit contractName args network code tr ts tv
          (Just toAddr) -> do
            return . Transaction' $ MessageTX nonce gasLimit toAddr funcName args network tr ts tv
  parseJSON _ = error "bad param when calling parseJSON for Transaction'"


{-
  = MessageTX
      { transactionNonce :: Integer,
        transactionGasLimit :: Integer,
        transactionTo :: Address,
        transactionFuncName :: Text,
        transactionArgs :: [Text],
        transactionNetwork :: Text,
        transactionR :: Integer,
        transactionS :: Integer,
        transactionV :: Word8
      }
  | ContractCreationTX
      { transactionNonce :: Integer,
        transactionGasLimit :: Integer,
        transactionContractName :: Text,
        transactionArgs :: [Text],
        transactionNetwork :: Text,
        transactionCode :: Code,
        transactionR :: Integer,
        transactionS :: Integer,
        transactionV :: Word8
      }
-}


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
                       [ProposalSignatureRef] ->
                       [CommitmentSignatureRef] ->
                       [Transaction] ->
                       Block
blockDataRefToBlock bdr vs vd ps sigs txs = case vs of
  [] -> -- this is a v1 block
    Block
      { blockBlockData =
          BlockHeader
            { parentHash = blockDataRefParentHash bdr,
              ommersHash = blockDataRefUnclesHash bdr,
              beneficiary = blockDataRefCoinbase bdr,
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
              newValidators = mapMaybe (vdr2v True) vd,
              removedValidators = mapMaybe (vdr2v False) vd,
              newCerts = [],
              revokedCerts = [],
              proposalSignature = join . listToMaybe $ psr2s <$> ps,
              signatures = mapMaybe csr2s sigs
            },
        blockReceiptTransactions = txs,
        blockBlockUncles = []
      }

bPrimeToB :: Block' -> Block
bPrimeToB (Block' x _) = x

newtype BlockData' = BlockData' BlockHeader deriving (Eq, Show)

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
              <*> v .:? "logBloom" .!= B.replicate 64 0x30 -- this is what log blooms currently get set to
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

newtype BlockDataRef' = BlockDataRef' BlockDataRef deriving (Eq, Show)

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
{-
bdrToBdrPrime :: BlockDataRef -> BlockDataRef'
bdrToBdrPrime = BlockDataRef'
-}
bvr2v :: BlockValidatorRef -> Validator
bvr2v (BlockValidatorRef _ cn) = cn

vdr2v :: Bool -> ValidatorDeltaRef -> Maybe Validator
vdr2v d' (ValidatorDeltaRef _ cn d) | d' == d = Just cn
vdr2v _ _ = Nothing

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
  toJSON (AddressStateRef' (AddressStateRef addr n b cr ch cn cpa bNum) next) =
    object
      [ "next" .= next,
        "kind" .= ("AddressStateRef" :: String),
        "address" .= addr,
        "nonce" .= n,
        "balance" .= show b,
        "contractRoot" .= cr,
        "codeHash" .= ch,
        "contractName" .= cn,
        "codePtrAddress" .= cpa,
        "latestBlockNum" .= bNum
      ]

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
                  <*> s .: "latestBlockNum"
              )
  parseJSON _ = fail "JSON not an object"

asrToAsrPrime :: (String, AddressStateRef) -> AddressStateRef'
asrToAsrPrime (s, x) = AddressStateRef' x s

asrToAsrPrime' :: AddressStateRef -> AddressStateRef'
asrToAsrPrime' x = AddressStateRef' x ""

data Address' = Address' Address String deriving (Eq, Show)
{-
adToAdPrime :: Address -> Address'
adToAdPrime x = Address' x ""
-}
--instance ToJSON Address' where
--  toJSON (Address' x) = object [ "address" .= (showHex x "") ]

data TransactionType = Contract | FunctionCall | Transfer deriving (Eq, Show)

--instance ToJSON TransactionType where
--   toJSON x = object ["transactionType" .= show x]

transactionSemantics :: Transaction -> TransactionType

transactionSemantics MessageTX{} = FunctionCall
transactionSemantics _ = Contract

rawTransactionSemantics :: RawTransaction -> TransactionType
rawTransactionSemantics RawTransaction{..} | isJust rawTransactionCode = Contract
rawTransactionSemantics _ = FunctionCall
