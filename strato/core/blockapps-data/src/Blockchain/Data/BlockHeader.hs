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
    getBlockProposal,
    getBlockSignatures,
    getBlockRound,
    getBlockStakes,
    getBlockStakeUpdates,
    setBlockRound,
    setBlockStakes,
    nextValidatorsAndStakes,
    clearBlockProposal,
    clearBlockSignatures,
    genBlockHeaderV3
  )
where

import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Blockstanbul.Model.Authentication
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class
import SolidVM.Model.Delta (applyStakeDelta)
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
import qualified Data.Map.Strict as M
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
    beneficiary :: Address,
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
    proposalSignature :: Maybe Signature,
    signatures :: [Signature]
  } |
  -- | Version 3: version 2 plus the consensus round the block was proposed in
  -- (0 = the intended proposer), the stake weights in force for this block and
  -- the stake updates published during this block (see
  -- "Blockchain.Strato.Model.ProposerSelection").
  BlockHeaderV3 {
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
    proposalRound :: Integer,
    currentStakes :: [(Validator, Integer)],
    stakeUpdates :: [(Validator, Integer)],
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
getBlockDifficulty BlockHeaderV3 {} = 1

getBlockGasLimit :: BlockHeader -> Integer
getBlockGasLimit BlockHeader { gasLimit } = gasLimit
getBlockGasLimit BlockHeaderV2 {} = 22500000000000000000000000000000 -- arbitrary as FUCK
getBlockGasLimit BlockHeaderV3 {} = 22500000000000000000000000000000

getBlockGasUsed :: BlockHeader -> Integer
getBlockGasUsed BlockHeader { gasUsed } = gasUsed
getBlockGasUsed BlockHeaderV2 {} = 0
getBlockGasUsed BlockHeaderV3 {} = 0

getBlockOmmersHash :: BlockHeader -> Keccak256
getBlockOmmersHash BlockHeader { ommersHash } = ommersHash
getBlockOmmersHash BlockHeaderV2 {} = (hash . rlpSerialize . RLPArray) []
getBlockOmmersHash BlockHeaderV3 {} = (hash . rlpSerialize . RLPArray) []

getBlockBeneficiary :: BlockHeader -> Address
getBlockBeneficiary BlockHeader { beneficiary } = beneficiary
getBlockBeneficiary BlockHeaderV2 {} = 0x0
getBlockBeneficiary BlockHeaderV3 {} = 0x0

getBlockMixHash :: BlockHeader -> Keccak256
getBlockMixHash BlockHeader { mixHash } = mixHash
getBlockMixHash BlockHeaderV2 {} = zeroHash
getBlockMixHash BlockHeaderV3 {} = zeroHash

getBlockNonce :: BlockHeader -> Word64
getBlockNonce BlockHeader { nonce } = nonce
getBlockNonce BlockHeaderV2 {} = 0
getBlockNonce BlockHeaderV3 {} = 0

getBlockValidators :: BlockHeader -> [Validator]
getBlockValidators BlockHeader {} = []
getBlockValidators BlockHeaderV2 { currentValidators } = currentValidators
getBlockValidators BlockHeaderV3 { currentValidators } = currentValidators

getBlockNewValidators :: BlockHeader -> [Validator]
getBlockNewValidators BlockHeader {} = []
getBlockNewValidators BlockHeaderV2 { newValidators } = newValidators
getBlockNewValidators BlockHeaderV3 { newValidators } = newValidators

getBlockRemovedValidators :: BlockHeader -> [Validator]
getBlockRemovedValidators BlockHeader {} = []
getBlockRemovedValidators BlockHeaderV2 { removedValidators } = removedValidators
getBlockRemovedValidators BlockHeaderV3 { removedValidators } = removedValidators

getBlockProposal :: BlockHeader -> Maybe Signature
getBlockProposal BlockHeader {} = Nothing
getBlockProposal BlockHeaderV2 { proposalSignature } = proposalSignature
getBlockProposal BlockHeaderV3 { proposalSignature } = proposalSignature

getBlockSignatures :: BlockHeader -> [Signature]
getBlockSignatures BlockHeader {} = []
getBlockSignatures BlockHeaderV2 { signatures } = signatures
getBlockSignatures BlockHeaderV3 { signatures } = signatures

getBlockRound :: BlockHeader -> Integer
getBlockRound BlockHeaderV3 { proposalRound } = proposalRound
getBlockRound _ = 0

getBlockStakes :: BlockHeader -> [(Validator, Integer)]
getBlockStakes BlockHeaderV3 { currentStakes } = currentStakes
getBlockStakes _ = []

getBlockStakeUpdates :: BlockHeader -> [(Validator, Integer)]
getBlockStakeUpdates BlockHeaderV3 { stakeUpdates } = stakeUpdates
getBlockStakeUpdates _ = []

-- | Set the proposal round (no-op for headers before version 3).
setBlockRound :: Integer -> BlockHeader -> BlockHeader
setBlockRound r b@BlockHeaderV3 {} = b{proposalRound = r}
setBlockRound _ b = b

-- | Set the stake weights in force (no-op for headers before version 3).
setBlockStakes :: [(Validator, Integer)] -> BlockHeader -> BlockHeader
setBlockStakes st b@BlockHeaderV3 {} = b{currentStakes = st}
setBlockStakes _ b = b

-- | The validator set and stake weights in force for the block *following*
-- the given header, i.e. the header's own sets with its deltas applied.
nextValidatorsAndStakes :: BlockHeader -> (S.Set Validator, M.Map Validator Integer)
nextValidatorsAndStakes h =
  ( S.union (S.fromList $ getBlockValidators h) (S.fromList $ getBlockNewValidators h)
      `S.difference` S.fromList removed
  , applyStakeDelta removed (M.fromList $ getBlockStakeUpdates h) (M.fromList $ getBlockStakes h)
  )
  where removed = getBlockRemovedValidators h

clearBlockProposal :: BlockHeader -> BlockHeader
clearBlockProposal b@BlockHeader {} = b
clearBlockProposal b@BlockHeaderV2 {} = b{proposalSignature = Nothing}
clearBlockProposal b@BlockHeaderV3 {} = b{proposalSignature = Nothing}

clearBlockSignatures :: BlockHeader -> BlockHeader
clearBlockSignatures b@BlockHeader {} = b
clearBlockSignatures b@BlockHeaderV2 {} = b{signatures = []}
clearBlockSignatures b@BlockHeaderV3 {} = b{signatures = []}

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
            ++ "proposalSignature: " ++ show proposalSignature ++ "\n"
            ++ "signatures: " ++ show signatures ++ "\n"
        )
  format header@BlockHeaderV3{..} =
    CL.blue ("BlockHeader (version 3) #" ++ show number) ++ " " ++ format (headerHash header)
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
            ++ "proposalRound: " ++ show proposalRound ++ "\n"
            ++ "currentStakes: " ++ show currentStakes ++ "\n"
            ++ "stakeUpdates: " ++ show stakeUpdates ++ "\n"
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
        rlpEncode proposalSignature,
        rlpEncode signatures
      ]
  rlpEncode BlockHeaderV3{..} =
    RLPArray $
      [ rlpEncode (3::Integer), -- BlockHeader version number
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
        rlpEncode proposalRound,
        rlpEncode currentStakes,
        rlpEncode stakeUpdates,
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
  rlpDecode (RLPArray [v, ph, sr, tr, rr, lb, number', ts, ed, vs, nv, rv, p, ss])
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
            proposalSignature = rlpDecode p,
            signatures = rlpDecode ss
          }
  rlpDecode (RLPArray [v, ph, sr, tr, rr, lb, number', ts, ed, vs, nv, rv, pr, cs, su, p, ss])
    | rlpDecode v == (3 :: Integer) =
          BlockHeaderV3
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
            proposalRound = rlpDecode pr,
            currentStakes = rlpDecode cs,
            stakeUpdates = rlpDecode su,
            proposalSignature = rlpDecode p,
            signatures = rlpDecode ss
          }
  rlpDecode x = error $ "can not run rlpDecode on BlockHeader for value " ++ show x

instance HasIstanbulExtra BlockHeader where
  getIstanbulExtra bh = case bh of
    BlockHeader{..} -> _istanbul $ cookRawExtra extraData
    BlockHeaderV2{..} -> Just $ IstanbulExtra currentValidators proposalSignature signatures
    BlockHeaderV3{..} -> Just $ IstanbulExtra currentValidators proposalSignature signatures
  putIstanbulExtra mIst bh = case bh of
    BlockHeader{..} -> bh{extraData = uncookRawExtra . set istanbul mIst $ cookRawExtra extraData}
    _ -> bh
      { currentValidators = maybe [] _validatorList mIst
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
  blockHeaderProposal = getBlockProposal
  blockHeaderSignatures = getBlockSignatures
  blockHeaderRound = getBlockRound
  blockHeaderStakes = getBlockStakes
  blockHeaderStakeUpdates = getBlockStakeUpdates
  blockHeaderVersion = bh where
    bh BlockHeader {} = 1
    bh BlockHeaderV2 {} = 2
    bh BlockHeaderV3 {} = 3

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
        proposalSignature = blockHeaderProposal b,
        signatures = blockHeaderSignatures b
      }
    3 ->
      BlockHeaderV3 {
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
        proposalRound = blockHeaderRound b,
        currentStakes = blockHeaderStakes b,
        stakeUpdates = blockHeaderStakeUpdates b,
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

-- | Generator for version-3 headers (the 'Arbitrary' instance stays V1 for
-- backwards compatibility with existing tests).
genBlockHeaderV3 :: Gen BlockHeader
genBlockHeaderV3 = do
  parentHash' <- arbitrary
  stateRoot' <- arbitrary
  transactionsRoot' <- arbitrary
  receiptsRoot' <- arbitrary
  logBloom' <- fastRandBs 256
  number' <- unboxPI <$> arbitrary
  timestamp' <- posixSecondsToUTCTime . fromInteger . unboxPI <$> arbitrary
  extraData' <- B.take 32 <$> arbitrary
  validators' <- listOf1 arbitrary
  stakes' <- forM validators' $ \v -> (,) v . unboxPI <$> arbitrary
  updates' <- sublistOf stakes'
  round' <- unboxPI <$> arbitrary
  return
    BlockHeaderV3
      { parentHash = parentHash',
        stateRoot = stateRoot',
        transactionsRoot = transactionsRoot',
        receiptsRoot = receiptsRoot',
        logsBloom = logBloom',
        number = number',
        timestamp = timestamp',
        extraData = extraData',
        currentValidators = validators',
        newValidators = [],
        removedValidators = [],
        proposalRound = round',
        currentStakes = stakes',
        stakeUpdates = updates',
        proposalSignature = Nothing,
        signatures = []
      }
