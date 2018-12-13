{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.Data.ArbitraryInstances where

import           Data.DeriveTH
import           Data.Maybe                         (fromJust, isJust)
import           Test.QuickCheck

import           Data.ByteString.Arbitrary
import qualified Data.ByteString                    as B
import qualified Data.ByteString.Internal           as IB
import qualified Data.Map                           as M    hiding (map, filter)
import qualified Data.Text                          as T
import           Data.Time
import           Data.Word

import           System.IO.Unsafe                   (unsafePerformIO)

import           Blockchain.Data.Address
import           Blockchain.Data.BlockDB
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Code
import           Blockchain.Data.Enode
import           Blockchain.Data.Transaction
import           Blockchain.Data.TXOrigin
import           Blockchain.Database.MerklePatricia hiding (stateRoot)
import           Blockchain.ExtWord
import           Blockchain.SHA
import           Blockchain.Util

import qualified Network.Haskoin.Crypto             as H


-- via https://gist.github.com/agrafix/2b48ec069693e3ab851e
instance Arbitrary UTCTime where
    arbitrary =
        do randomDay <- choose (1, 28) :: Gen Int
           randomMonth <- choose (1, 12) :: Gen Int
           randomYear <- choose (1970, 2018) :: Gen Integer
           randomTime <- choose (0, 86399) :: Gen Int
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

instance Arbitrary T.Text where
  arbitrary = T.pack <$> arbitrary

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
        chainId   <- arbitrary
        md        <- arbitrary
        case isMessage of
            True  -> do
                to     <- arbitrary
                txData <- arbitrary
                return . unsafePerformIO .
                    H.withSource H.devURandom $
                        createChainMessageTX nonce gasPrice gasLimit to value txData chainId md prvKey
            False -> do
                contractCode <- arbitrary
                return . unsafePerformIO .
                    H.withSource H.devURandom $
                        createChainContractCreationTX nonce gasPrice gasLimit value contractCode chainId md prvKey

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

instance Arbitrary IPAddress where
  arbitrary = IPv4 <$> arbitrary

instance Arbitrary Enode where
  arbitrary = Enode
          <$> (B.pack <$> vectorOf 64 arbitrary)
          <*> arbitrary
          <*> arbitrary `suchThat` (>=0)
          <*> (arbitrary `suchThat` maybe True (>=0))

instance Arbitrary CodeInfo where
  arbitrary = CodeInfo
      <$> arbitrary
      <*> (T.pack <$> arbitrary)
      <*> (T.pack <$> arbitrary)

instance Arbitrary AccountInfo where
  arbitrary = NonContract
      <$> arbitrary
      <*> arbitrary `suchThat` (>=0)

instance Arbitrary ChainInfo where
  arbitrary = do
    cl <- arbitrary :: Gen T.Text
    ai <- arbitrary :: Gen [AccountInfo]
    ci <- arbitrary :: Gen [CodeInfo]
    mb <- arbitrary :: Gen (M.Map Address Enode)
    pc <- arbitrary :: Gen (Maybe Word256)
    cb <- arbitrary :: Gen SHA
    cn <- arbitrary :: Gen Word256
    md <- arbitrary :: Gen (M.Map T.Text T.Text)
    r <- arbitrary :: Gen Word256
    s <- arbitrary :: Gen Word256
    v <- arbitrary :: Gen Word8
    return (ChainInfo cl ai ci mb pc cb cn md r s v)
