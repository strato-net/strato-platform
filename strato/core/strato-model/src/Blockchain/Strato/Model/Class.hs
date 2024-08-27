{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}

module Blockchain.Strato.Model.Class where

import BlockApps.X509.Certificate
import Blockchain.Blockstanbul.Model.Authentication
import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator (Validator)
import Control.DeepSeq
import Data.Aeson
import qualified Data.ByteString as B
import Data.Data
import Data.Map.Strict (Map)
import Data.Text (Text)
import Data.Time
import Data.Word
import GHC.Generics

class (RLPSerializable b, BlockHeaderLike h, TransactionLike t) => BlockLike h t b | b -> h t where
  blockHeader :: b -> h
  blockTransactions :: b -> [t]
  blockUncleHeaders :: b -> [h]

  buildBlock :: h -> [t] -> [h] -> b
  {-# MINIMAL blockHeader, blockTransactions, blockUncleHeaders, buildBlock #-}

  blockOrdering :: b -> Integer
  blockOrdering = blockHeaderOrdering . blockHeader

  blockHash :: b -> Keccak256
  blockHash = blockHeaderHash . blockHeader

  buildBlock' :: (BlockHeaderLike h2, TransactionLike t2) => h2 -> [t2] -> [h2] -> b
  buildBlock' head' txs' uncles' =
    buildBlock (morphBlockHeader head') (morphTx <$> txs') (morphBlockHeader <$> uncles')

  morphBlock :: (BlockLike h2 t2 b2) => b2 -> b
  morphBlock b2 = buildBlock' (blockHeader b2) (blockTransactions b2) (blockUncleHeaders b2)

newtype DummyCertRevocation = DummyCertRevocation Address deriving (Show, Read, Eq, NFData, Generic, Data, ToJSON, RLPSerializable)

class (RLPSerializable h, HasIstanbulExtra h) => BlockHeaderLike h where
  blockHeaderBlockNumber :: h -> Integer
  blockHeaderParentHash :: h -> Keccak256
  blockHeaderOmmersHash :: h -> Keccak256
  blockHeaderBeneficiary :: h -> ChainMemberParsedSet
  blockHeaderStateRoot :: h -> B.ByteString -- todo: "StateRoot" thats not the MPDB StateRoot
  blockHeaderTransactionsRoot :: h -> B.ByteString -- todo: ditto
  blockHeaderReceiptsRoot :: h -> B.ByteString -- todo: ditto
  blockHeaderLogsBloom :: h -> B.ByteString -- todo: "Bloom" data?
  blockHeaderGasLimit :: h -> Integer -- todo: "gas" newtype?
  blockHeaderGasUsed :: h -> Integer -- todo: ditto
  blockHeaderDifficulty :: h -> Integer
  blockHeaderNonce :: h -> Word64 -- todo: nonce newtype
  blockHeaderExtraData :: h -> B.ByteString -- todo: extradata newtype
  blockHeaderTimestamp :: h -> UTCTime
  blockHeaderMixHash :: h -> Keccak256
  blockHeaderValidators :: h -> [Validator]
  blockHeaderNewValidators :: h -> [Validator]
  blockHeaderRemovedValidators :: h -> [Validator]
  blockHeaderNewCerts :: h -> [X509Certificate]
  blockHeaderRevokedCerts :: h -> [DummyCertRevocation]
  blockHeaderProposal :: h -> Maybe Signature
  blockHeaderSignatures :: h -> [Signature]
  blockHeaderVersion :: h -> Int

  morphBlockHeader :: (BlockHeaderLike h2) => h2 -> h
  {-# MINIMAL
    blockHeaderBlockNumber,
    blockHeaderParentHash,
    blockHeaderOmmersHash,
    blockHeaderBeneficiary,
    blockHeaderStateRoot,
    blockHeaderTransactionsRoot,
    blockHeaderReceiptsRoot,
    blockHeaderLogsBloom,
    blockHeaderDifficulty,
    blockHeaderGasLimit,
    blockHeaderGasUsed,
    blockHeaderDifficulty,
    blockHeaderNonce,
    blockHeaderExtraData,
    blockHeaderTimestamp,
    blockHeaderMixHash,
    blockHeaderValidators,
    blockHeaderNewValidators,
    blockHeaderRemovedValidators,
    blockHeaderNewCerts,
    blockHeaderRevokedCerts,
    blockHeaderProposal,
    blockHeaderSignatures,
    morphBlockHeader,
    blockHeaderVersion
    #-}

  blockHeaderHash :: h -> Keccak256
  blockHeaderHash =
    hash
      . rlpSerialize
      . rlpEncode
      . scrubCommitmentSeals

  -- This is a PBFT style partial hash. PoW style partial hash should remove the nonce instead.
  blockHeaderPartialHash :: h -> Keccak256
  blockHeaderPartialHash = blockHeaderHash
                         . scrubConsensus

  blockHeaderOrdering :: h -> Integer
  blockHeaderOrdering = blockHeaderBlockNumber

data TransactionType = ContractCreation | Message | PrivateHash deriving (Eq, Ord, Read, Show)

-- todo: newtype all these vague Integers
class (RLPSerializable t) => TransactionLike t where
  txHash :: t -> Keccak256
  txPartialHash :: t -> Keccak256
  txChainHash :: t -> Keccak256
  txSigner :: t -> Maybe Address
  txNonce :: t -> Integer
  txType :: t -> TransactionType
  txSignature :: t -> (Integer, Integer, Word8)
  txValue :: t -> Integer
  txDestination :: t -> Maybe Address
  txGasPrice :: t -> Integer
  txGasLimit :: t -> Integer
  txCode :: t -> Maybe Code
  txData :: t -> Maybe B.ByteString -- todo make a `Code` newtype
  txChainId :: t -> Maybe Word256
  txMetadata :: t -> Maybe (Map Text Text)

  morphTx :: (TransactionLike t2) => t2 -> t
  {-# MINIMAL
    txHash,
    txPartialHash,
    txChainHash,
    txSigner,
    txNonce,
    txType,
    txSignature,
    txValue,
    txDestination,
    txGasPrice,
    txGasLimit,
    txCode,
    txData,
    txChainId,
    txMetadata,
    morphTx
    #-}

  txSigR :: t -> Integer
  txSigR t = let (r, _, _) = txSignature t in r

  txSigS :: t -> Integer
  txSigS t = let (_, s, _) = txSignature t in s

  txSigV :: t -> Word8
  txSigV t = let (_, _, v) = txSignature t in v
