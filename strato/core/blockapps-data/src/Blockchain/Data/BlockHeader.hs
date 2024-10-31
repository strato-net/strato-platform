{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE NamedFieldPuns #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.BlockHeader
  ( BlockHeader (..),
    headerHash,
    extraData2TxsLen,
    mixHashlens,
    extraDataLens,
    txsLen2ExtraData,
    getBlockBeneficiary,
    getBlockDifficulty,
    getBlockGasLimit,
    getBlockGasUsed,
    getBlockMixHash,
    getBlockNonce,
    getBlockOmmersHash,
    getBlockValidators,
    getBlockNewValidators,
    getBlockRemovedValidators,
    getBlockNewCerts,
    getBlockRevokedCerts,
    getBlockProposal,
    getBlockSignatures,
    clearBlockProposal,
    clearBlockSignatures
  )
where

import BlockApps.X509.Certificate
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Blockstanbul.Model.Authentication
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.PositiveInteger
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Control.DeepSeq
import Control.Lens
import Control.Monad
import Data.Binary
import Data.Bits (shiftL, shiftR)
import qualified Data.ByteString as B
import Data.ByteString.Arbitrary
import qualified Data.Set as S
import Data.Time
import Data.Time.Clock.POSIX
import GHC.Generics
import Numeric
import Test.QuickCheck
import qualified Text.Colors as CL
import Text.Format
import Text.Tools

data BlockHeader =
  BlockHeader {
    parentHash :: Keccak256,
    ommersHash :: Keccak256,
    beneficiary :: ChainMemberParsedSet,
    stateRoot :: MP.StateRoot,
    transactionsRoot :: MP.StateRoot,
    receiptsRoot :: MP.StateRoot,
    logsBloom :: B.ByteString,
    difficulty :: Integer,
    number :: Integer,
    gasLimit :: Integer,
    gasUsed :: Integer,
    timestamp :: UTCTime,
    extraData :: B.ByteString,
    mixHash :: Keccak256,
    nonce :: Word64
  } |
  BlockHeaderV2 {
    parentHash :: Keccak256,
    stateRoot :: MP.StateRoot,
    transactionsRoot :: MP.StateRoot,
    receiptsRoot :: MP.StateRoot,
    logsBloom :: B.ByteString,
    number :: Integer,
    timestamp :: UTCTime,
    extraData :: B.ByteString,
    currentValidators :: [Validator],
    newValidators :: [Validator],
    removedValidators :: [Validator],
    newCerts :: [X509Certificate],
    revokedCerts :: [DummyCertRevocation],
    proposalSignature :: Maybe Signature,
    signatures :: [Signature]
  }
  deriving (Eq, Show, Generic)

instance Binary UTCTime where
  put = put . (round :: POSIXTime -> Integer) . utcTimeToPOSIXSeconds
  get = (posixSecondsToUTCTime . fromInteger) <$> get

instance Binary BlockHeader

instance NFData BlockHeader

instance Binary DummyCertRevocation

-- These getters are meant to be used in `instance BlockHeaderLike BlockHeader`
-- so that the class may handle both V1 and V2

getBlockDifficulty :: BlockHeader -> Integer
getBlockDifficulty BlockHeader { difficulty } = difficulty
getBlockDifficulty BlockHeaderV2 {} = 1

getBlockGasLimit :: BlockHeader -> Integer
getBlockGasLimit BlockHeader { gasLimit } = gasLimit
getBlockGasLimit BlockHeaderV2 {} = 22500000000000000000000000000000 -- arbitrary as FUCK

getBlockGasUsed :: BlockHeader -> Integer
getBlockGasUsed BlockHeader { gasUsed } = gasUsed
getBlockGasUsed BlockHeaderV2 {} = 0

getBlockOmmersHash :: BlockHeader -> Keccak256
getBlockOmmersHash BlockHeader { ommersHash } = ommersHash
getBlockOmmersHash BlockHeaderV2 {} = (hash . rlpSerialize . RLPArray) []

getBlockBeneficiary :: BlockHeader -> ChainMemberParsedSet
getBlockBeneficiary BlockHeader { beneficiary } = beneficiary
getBlockBeneficiary BlockHeaderV2 {} = Everyone False

getBlockMixHash :: BlockHeader -> Keccak256
getBlockMixHash BlockHeader { mixHash } = mixHash
getBlockMixHash BlockHeaderV2 {} = zeroHash

getBlockNonce :: BlockHeader -> Word64
getBlockNonce BlockHeader { nonce } = nonce
getBlockNonce BlockHeaderV2 {} = 0

getBlockValidators :: BlockHeader -> [Validator]
getBlockValidators BlockHeader {} = []
getBlockValidators BlockHeaderV2 { currentValidators } = currentValidators

getBlockNewValidators :: BlockHeader -> [Validator]
getBlockNewValidators BlockHeader {} = []
getBlockNewValidators BlockHeaderV2 { newValidators } = newValidators

getBlockRemovedValidators :: BlockHeader -> [Validator]
getBlockRemovedValidators BlockHeader {} = []
getBlockRemovedValidators BlockHeaderV2 { removedValidators } = removedValidators

getBlockNewCerts :: BlockHeader -> [X509Certificate]
getBlockNewCerts BlockHeader {} = []
getBlockNewCerts BlockHeaderV2 { newCerts } = newCerts

getBlockRevokedCerts :: BlockHeader -> [DummyCertRevocation]
getBlockRevokedCerts BlockHeader {} = []
getBlockRevokedCerts BlockHeaderV2 { revokedCerts } = revokedCerts

getBlockProposal :: BlockHeader -> Maybe Signature
getBlockProposal BlockHeader {} = Nothing
getBlockProposal BlockHeaderV2 { proposalSignature } = proposalSignature

getBlockSignatures :: BlockHeader -> [Signature]
getBlockSignatures BlockHeader {} = []
getBlockSignatures BlockHeaderV2 { signatures } = signatures

clearBlockProposal :: BlockHeader -> BlockHeader
clearBlockProposal b@BlockHeader {} = b
clearBlockProposal b@BlockHeaderV2 {} = b{proposalSignature = Nothing}

clearBlockSignatures :: BlockHeader -> BlockHeader
clearBlockSignatures b@BlockHeader {} = b
clearBlockSignatures b@BlockHeaderV2 {} = b{signatures = []}

makeLensesFor [("extraData", "extraDataLens"), ("mixHash", "mixHashlens")] ''BlockHeader

instance Format BlockHeader where
  format header@(BlockHeader ph oh b sr tr rr _ d number' gl gu ts ed _ nonce') =
    CL.blue ("BlockHeader #" ++ show number') ++ " " ++ format (headerHash header)
      ++ tab'
        ( "\nparentHash: " ++ format ph ++ "\n"
          ++ "ommersHash: " ++ format oh ++ (if oh == hash (B.pack [0xc0]) then " (the empty array)\n" else "\n")
          ++ "beneficiary: " ++ format b ++ "\n"
          ++ "stateRoot: " ++ format sr ++ "\n"
          ++ "transactionsRoot: " ++ format tr ++ "\n"
          ++ "receiptsRoot: " ++ format rr ++ "\n"
          ++ "difficulty: " ++ show d ++ "\n"
          ++ "gasLimit: " ++ show gl ++ "\n"
          ++ "gasUsed: " ++ show gu ++ "\n"
          ++ "timestamp: " ++ show ts ++ "\n"
          ++ "extraData: " ++ show ed ++ "\n"
          ++ "nonce: " ++ showHex nonce' "" ++ "\n"
        )
  format header@BlockHeaderV2{..} =
    CL.blue ("BlockHeader (version 2) #" ++ show number) ++ " " ++ format (headerHash header)
      ++ tab'
        ( "\nparentHash: " ++ format parentHash ++ "\n"
            ++ "stateRoot: " ++ format stateRoot ++ "\n"
            ++ "transactionsRoot: " ++ format transactionsRoot ++ "\n"
            ++ "receiptsRoot: " ++ format receiptsRoot ++ "\n"
            ++ "timestamp: " ++ show timestamp ++ "\n"
            ++ "extraData: " ++ show extraData ++ "\n"
            ++ "currentValidators: " ++ show currentValidators ++ "\n"
            ++ "newValidators: " ++ show newValidators ++ "\n"
            ++ "removedValidators: " ++ show removedValidators ++ "\n"
            ++ "newCerts: " ++ show newCerts ++ "\n"
            ++ "revokedCerts: " ++ show revokedCerts ++ "\n"
            ++ "proposalSignature: " ++ show proposalSignature ++ "\n"
            ++ "signatures: " ++ show signatures ++ "\n"
        )

instance RLPSerializable BlockHeader where
  rlpEncode (BlockHeader ph oh b sr tr rr lb d number' gl gu ts ed mh nonce') =
    RLPArray $
      [ rlpEncode ph,
        rlpEncode oh,
        rlpEncode b,
        rlpEncode sr,
        rlpEncode tr,
        rlpEncode rr,
        rlpEncode lb,
        rlpEncode d,
        rlpEncode number',
        rlpEncode gl,
        rlpEncode gu,
        rlpEncode (round $ utcTimeToPOSIXSeconds ts :: Integer),
        rlpEncode ed,
        rlpEncode mh,
        rlpEncode $ B.pack $ word64ToBytes nonce'
      ]
  rlpEncode BlockHeaderV2{..} =
    RLPArray $
      [ rlpEncode (2::Integer), -- BlockHeader version number
        rlpEncode parentHash,
        rlpEncode stateRoot,
        rlpEncode transactionsRoot,
        rlpEncode receiptsRoot,
        rlpEncode logsBloom,
        rlpEncode number,
        rlpEncode (round $ utcTimeToPOSIXSeconds timestamp :: Integer),
        rlpEncode extraData,
        rlpEncode currentValidators,
        rlpEncode newValidators,
        rlpEncode removedValidators,
        rlpEncode newCerts,
        rlpEncode revokedCerts,
        rlpEncode proposalSignature,
        rlpEncode signatures
      ]
  rlpDecode (RLPArray [ph, oh, b, sr, tr, rr, lb, d, number', gl, gu, ts, ed, mh, nonce']) =
        BlockHeader
        { parentHash = rlpDecode ph,
          ommersHash = rlpDecode oh,
          beneficiary = rlpDecode b,
          stateRoot = rlpDecode sr,
          transactionsRoot = rlpDecode tr,
          receiptsRoot = rlpDecode rr,
          logsBloom = rlpDecode lb,
          difficulty = rlpDecode d,
          number = rlpDecode number',
          gasLimit = rlpDecode gl,
          gasUsed = rlpDecode gu,
          timestamp = posixSecondsToUTCTime $ fromInteger $ rlpDecode ts,
          extraData = rlpDecode ed,
          mixHash = rlpDecode mh,
          nonce = bytesToWord64 $ B.unpack $ rlpDecode nonce'
        }
  rlpDecode (RLPArray [v, ph, sr, tr, rr, lb, number', ts, ed, vs, nv, rv, nc, rc, p, ss])
    | rlpDecode v == (2 :: Integer) =
          BlockHeaderV2
          { parentHash = rlpDecode ph,
            stateRoot = rlpDecode sr,
            transactionsRoot = rlpDecode tr,
            receiptsRoot = rlpDecode rr,
            logsBloom = rlpDecode lb,
            number = rlpDecode number',
            timestamp = posixSecondsToUTCTime $ fromInteger $ rlpDecode ts,
            extraData = rlpDecode ed,
            currentValidators = rlpDecode vs,
            newValidators = rlpDecode nv,
            removedValidators = rlpDecode rv,
            newCerts = rlpDecode nc,
            revokedCerts = rlpDecode rc,
            proposalSignature = rlpDecode p,
            signatures = rlpDecode ss
          }
  rlpDecode x = error $ "can not run rlpDecode on BlockHeader for value " ++ show x

instance HasIstanbulExtra BlockHeader where
  getIstanbulExtra bh = case bh of
    BlockHeader{..} -> _istanbul $ cookRawExtra extraData
    BlockHeaderV2{..} -> Just $ IstanbulExtra (ChainMembers . S.fromList $ validatorToChainMemberParsedSet <$> currentValidators) proposalSignature signatures
  putIstanbulExtra mIst bh = case bh of
    BlockHeader{..} -> bh{extraData = uncookRawExtra . set istanbul mIst $ cookRawExtra extraData}
    BlockHeaderV2{} -> bh
      { currentValidators = maybe [] (map chainMemberParsedSetToValidator . S.toList . unChainMembers . _validatorList) mIst
      , proposalSignature = maybe Nothing _proposedSig mIst
      , signatures = maybe [] _commitment mIst
      }

instance BlockHeaderLike BlockHeader where
  blockHeaderBlockNumber = number
  blockHeaderParentHash = parentHash
  blockHeaderOmmersHash = getBlockOmmersHash
  blockHeaderBeneficiary = getBlockBeneficiary
  blockHeaderStateRoot = MP.unboxStateRoot . stateRoot
  blockHeaderTransactionsRoot = MP.unboxStateRoot . transactionsRoot
  blockHeaderReceiptsRoot = MP.unboxStateRoot . receiptsRoot
  blockHeaderLogsBloom = logsBloom
  blockHeaderGasLimit = getBlockGasLimit
  blockHeaderGasUsed = getBlockGasUsed
  blockHeaderDifficulty = getBlockDifficulty
  blockHeaderNonce = getBlockNonce
  blockHeaderExtraData = extraData
  blockHeaderTimestamp = timestamp
  blockHeaderMixHash = getBlockMixHash
  blockHeaderValidators = getBlockValidators
  blockHeaderNewValidators = getBlockNewValidators
  blockHeaderRemovedValidators = getBlockRemovedValidators
  blockHeaderNewCerts = getBlockNewCerts
  blockHeaderRevokedCerts = getBlockRevokedCerts
  blockHeaderProposal = getBlockProposal
  blockHeaderSignatures = getBlockSignatures
  blockHeaderVersion = bh where
    bh BlockHeader {} = 1
    bh BlockHeaderV2 {} = 2

  morphBlockHeader b = case blockHeaderVersion b of
    1 -> 
      BlockHeader { 
        number = blockHeaderBlockNumber b,
        parentHash = blockHeaderParentHash b,
        ommersHash = blockHeaderOmmersHash b,
        beneficiary = blockHeaderBeneficiary b,
        stateRoot = MP.StateRoot $ blockHeaderStateRoot b,
        transactionsRoot = MP.StateRoot $ blockHeaderTransactionsRoot b,
        receiptsRoot = MP.StateRoot $ blockHeaderReceiptsRoot b,
        logsBloom = blockHeaderLogsBloom b,
        gasLimit = blockHeaderGasLimit b,
        gasUsed = blockHeaderGasUsed b,
        difficulty = blockHeaderDifficulty b,
        nonce = blockHeaderNonce b,
        extraData = blockHeaderExtraData b,
        timestamp = blockHeaderTimestamp b,
        mixHash = blockHeaderMixHash b
      }
    2 -> 
      BlockHeaderV2 { 
        number = blockHeaderBlockNumber b,
        parentHash = blockHeaderParentHash b,
        stateRoot = MP.StateRoot $ blockHeaderStateRoot b,
        transactionsRoot = MP.StateRoot $ blockHeaderTransactionsRoot b,
        receiptsRoot = MP.StateRoot $ blockHeaderReceiptsRoot b,
        logsBloom = blockHeaderLogsBloom b,
        extraData = blockHeaderExtraData b,
        timestamp = blockHeaderTimestamp b,
        currentValidators = blockHeaderValidators b,
        newValidators = blockHeaderNewValidators b,
        removedValidators = blockHeaderRemovedValidators b,
        newCerts = blockHeaderNewCerts b,
        revokedCerts = blockHeaderRevokedCerts b,
        proposalSignature = blockHeaderProposal b,
        signatures = blockHeaderSignatures b
      }
    _ -> error "Unknown block header version"

headerHash :: BlockHeader -> Keccak256
headerHash = blockHeaderHash

txsLen2ExtraData :: Int -> B.ByteString
txsLen2ExtraData len = B.singleton len1 <> B.singleton len2 <> B.replicate 30 0
  where
    len1 = fromIntegral $ shiftR len 8
    len2 = fromIntegral len

extraData2TxsLen :: B.ByteString -> Maybe Int
extraData2TxsLen ed = guard (B.length ed >= 32) >> result
  where
    len1 = toInteger $ B.index ed 0
    len2 = toInteger $ B.index ed 1
    len = (shiftL len1 8) + len2
    result = case len of
      0 -> Nothing
      x -> Just (fromInteger x :: Int)

instance Arbitrary BlockHeader where
  arbitrary = do
    parentHash' <- arbitrary
    uncleHash' <- arbitrary
    coinbase' <- arbitrary
    stateRoot' <- arbitrary
    transactionsRoot' <- arbitrary
    receiptsRoot' <- arbitrary
    logBloom' <- fastRandBs 256 -- 2048-bit bloom filter
    difficulty' <- unboxPI <$> arbitrary
    number' <- unboxPI <$> arbitrary
    gasLimit' <- unboxPI <$> arbitrary
    gasUsed' <- unboxPI <$> arbitrary `suchThat` (<= PositiveInteger gasLimit')
    timestamp' <- posixSecondsToUTCTime . fromInteger . unboxPI <$> arbitrary
    -- TODO(tim): Rather than making an artificial dependent type, guard Block against
    -- rogue long bytestrings.
    extraData' <- B.take 32 <$> arbitrary
    nonce' <- arbitrary
    mixHash' <- arbitrary
    return
      BlockHeader
        { parentHash = parentHash',
          ommersHash = uncleHash',
          beneficiary = coinbase',
          stateRoot = stateRoot',
          transactionsRoot = transactionsRoot',
          receiptsRoot = receiptsRoot',
          logsBloom = logBloom',
          difficulty = difficulty',
          number = number',
          gasLimit = gasLimit',
          gasUsed = gasUsed',
          timestamp = timestamp',
          extraData = extraData',
          nonce = nonce',
          mixHash = mixHash'
        }
