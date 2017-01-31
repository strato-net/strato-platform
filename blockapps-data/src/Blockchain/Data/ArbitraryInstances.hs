{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.Data.ArbitraryInstances where

import Data.DeriveTH
import Data.Maybe (fromJust, isJust)
import Test.QuickCheck

import Data.ByteString.Arbitrary
import qualified Data.ByteString.Internal as IB
import Data.Time

import System.IO.Unsafe (unsafePerformIO)

import Blockchain.Data.Address
import Blockchain.Data.BlockDB
import Blockchain.Data.Code
import Blockchain.Data.Transaction
import Blockchain.Data.TXOrigin
import Blockchain.Database.MerklePatricia
import Blockchain.SHA
import Blockchain.Util

import qualified Network.Haskoin.Crypto as H


-- via https://gist.github.com/agrafix/2b48ec069693e3ab851e
instance Arbitrary UTCTime where
    arbitrary =
        do randomDay <- choose (1, 29) :: Gen Int
           randomMonth <- choose (1, 12) :: Gen Int
           randomYear <- choose (2001, 2002) :: Gen Integer
           randomTime <- choose (0, 86401) :: Gen Int
           return $ UTCTime (fromGregorian randomYear randomMonth randomDay) (fromIntegral randomTime)

instance Arbitrary Microtime where
    arbitrary = (Microtime . unboxPI) <$> (arbitrary :: Gen PositiveInteger)

data PositiveInteger = PositiveInteger Integer deriving (Eq, Ord, Show, Read)
unboxPI :: PositiveInteger -> Integer
unboxPI (PositiveInteger n) = n
positiveIntegerMax :: Integer
positiveIntegerMax = 99999999

data HaskoinPrvKey = HaskoinPrvKey H.PrvKey
unboxPK :: HaskoinPrvKey -> H.PrvKey
unboxPK (HaskoinPrvKey pk) = pk

derive makeArbitrary ''TXOrigin

instance Arbitrary PositiveInteger where
    arbitrary = PositiveInteger . abs <$> arbitrary

instance Arbitrary HaskoinPrvKey where
    arbitrary = HaskoinPrvKey <$> fromJust <$> ((H.makePrvKey <$> arbitrary) `suchThat` (isJust))

instance Arbitrary Address where
    arbitrary = do
        random160Bit <- fastRandBs 20
        return . Address . fromIntegral . byteString2Integer $ random160Bit

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
        timestamp        <- arbitrary
        extraData        <- unboxPI <$> arbitrary
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
        bData         <- arbitrary
        bTransactions <- arbitrary
        bUncles       <- arbitrary

        return Block { blockBlockData            = bData
                     , blockBlockUncles          = bUncles
                     , blockReceiptTransactions  = bTransactions
                     }

instance Arbitrary Transaction where
    arbitrary = do
        nonce     <- unboxPI <$> arbitrary
        gasPrice  <- unboxPI <$> arbitrary
        gasLimit  <- arbitrary `suchThat` (> gasPrice)
        value     <- unboxPI <$> arbitrary
        prvKey    <- unboxPK <$> arbitrary
        isMessage <- arbitrary :: Gen Bool
        case isMessage of
            True  -> do
                to     <- arbitrary
                txData <- arbitrary
                return . unsafePerformIO .
                    H.withSource H.devURandom $
                        createMessageTX nonce gasPrice gasLimit to value txData prvKey
            False -> do
                contractCode <- arbitrary
                return . unsafePerformIO .
                    H.withSource H.devURandom $
                        createContractCreationTX nonce gasPrice gasLimit value contractCode prvKey

instance Arbitrary Code where
    -- PrecompiledCode can't be serialized!
    arbitrary = do
        randomCode <- arbitrary
        return $ Code { codeBytes = randomCode }

instance Arbitrary SHA where
    arbitrary = do
        random256Bit <- fastRandBs 32
        return . SHA . fromIntegral . byteString2Integer $ random256Bit

instance Arbitrary StateRoot where
    arbitrary = StateRoot <$> fastRandBs 32

instance Arbitrary IB.ByteString where
--     arbitrary = fastRandBs =<< choose (1024, 1024*1024) -- use this for (theoretical) correctness
    arbitrary = fastRandBs 1024 -- use this for speed

