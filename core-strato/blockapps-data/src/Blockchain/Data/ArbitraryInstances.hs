{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.Data.ArbitraryInstances where

import           Test.QuickCheck
import           Test.QuickCheck.Instances()

import           Data.ByteString.Arbitrary
import qualified Data.ByteString                    as B
import           Data.Time.Clock.POSIX

import           System.IO.Unsafe                   (unsafePerformIO)

import           Blockchain.Data.Block
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Transaction
import           Blockchain.Data.TXOrigin           ()
import           Blockchain.Database.MerklePatricia
import           Blockchain.Strato.Model.Secp256k1            ()
import           Blockchain.Util

instance Arbitrary Microtime where
    arbitrary = (Microtime . unboxPI) <$> (arbitrary :: Gen PositiveInteger)

data PositiveInteger = PositiveInteger Integer deriving (Eq, Ord, Show, Read)
unboxPI :: PositiveInteger -> Integer
unboxPI (PositiveInteger n) = n
positiveIntegerMax :: Integer
positiveIntegerMax = 99999999
{-
data HaskoinPrvKey = HaskoinPrvKey H.PrvKey
unboxPK :: HaskoinPrvKey -> H.PrvKey
unboxPK (HaskoinPrvKey pk) = pk
-}
instance Arbitrary PositiveInteger where
    arbitrary = PositiveInteger . abs <$> arbitrary

instance Arbitrary BlockData where
    arbitrary = do
        parentHash       <- arbitrary
        uncleHash        <- arbitrary
        coinbase         <- arbitrary
        stateRoot        <- arbitrary
        transactionsRoot <- arbitrary
        receiptsRoot     <- arbitrary
        logBloom         <- fastRandBs 256 -- 2048-bit bloom filter
        difficulty       <- unboxPI <$> arbitrary
        number           <- unboxPI <$> arbitrary
        gasLimit         <- unboxPI <$> arbitrary
        gasUsed          <- unboxPI <$> arbitrary `suchThat` (<= PositiveInteger gasLimit)
        timestamp        <- posixSecondsToUTCTime . fromInteger . unboxPI <$> arbitrary
        -- TODO(tim): Rather than making an artificial dependent type, guard Block against
        -- rogue long bytestrings.
        extraData        <- B.take 32 <$> arbitrary
        nonce            <- arbitrary
        mixHash          <- arbitrary
        return BlockData { blockDataParentHash       = parentHash
                         , blockDataUnclesHash       = uncleHash
                         , blockDataCoinbase         = coinbase
                         , blockDataStateRoot        = stateRoot
                         , blockDataTransactionsRoot = transactionsRoot
                         , blockDataReceiptsRoot     = receiptsRoot
                         , blockDataLogBloom         = logBloom
                         , blockDataDifficulty       = difficulty
                         , blockDataNumber           = number
                         , blockDataGasLimit         = gasLimit
                         , blockDataGasUsed          = gasUsed
                         , blockDataTimestamp        = timestamp
                         , blockDataExtraData        = extraData
                         , blockDataNonce            = nonce
                         , blockDataMixHash          = mixHash
                         }

instance Arbitrary Block where
    arbitrary = do
        txCount       <- choose (0, 20)
        uncleCount    <- choose (0, 2)
        bData         <- arbitrary
        bTransactions <- vectorOf txCount arbitrary
        bUncles       <- vectorOf uncleCount arbitrary

        return $ Block bData bTransactions bUncles

instance Arbitrary Transaction where
    arbitrary = do
      isPrivHash <- arbitrary :: Gen Bool
      if isPrivHash
        then do
          tHash <- arbitrary
          cHash <- arbitrary
          return $ PrivateHashTX tHash cHash
        else do
          nonce     <- unboxPI <$> arbitrary
          gasPrice  <- unboxPI <$> arbitrary
          gasLimit  <- arbitrary `suchThat` (> gasPrice)
          value     <- unboxPI <$> arbitrary
          prvKey    <- arbitrary
          isMessage <- arbitrary :: Gen Bool
          chainId   <- arbitrary
          md        <- arbitrary
          case isMessage of
              True  -> do
                  to     <- arbitrary
                  txData <- arbitrary
                  return . unsafePerformIO $
                          createChainMessageTX nonce gasPrice gasLimit to value txData chainId md prvKey
              False -> do
                  contractCode <- arbitrary
                  return . unsafePerformIO $
                          createChainContractCreationTX nonce gasPrice gasLimit value contractCode chainId md prvKey

instance Arbitrary RawTransaction where
    arbitrary = txAndTime2RawTX <$> arbitrary
                                <*> arbitrary
                                <*> arbitrary
                                <*> arbitrary

instance Arbitrary StateRoot where
    arbitrary = StateRoot <$> fastRandBs 32

