{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.ArbitraryInstances where

import Blockchain.Data.Block
import Blockchain.Data.DataDefs
import Blockchain.Data.TXOrigin ()
import Blockchain.Data.Transaction
import Blockchain.Strato.Model.PositiveInteger
import Blockchain.Strato.Model.Secp256k1 ()
import System.IO.Unsafe (unsafePerformIO)
import Test.QuickCheck
import Test.QuickCheck.Instances ()

{-
data HaskoinPrvKey = HaskoinPrvKey H.PrvKey
unboxPK :: HaskoinPrvKey -> H.PrvKey
unboxPK (HaskoinPrvKey pk) = pk
-}

instance Arbitrary Block where
  arbitrary = do
    txCount <- choose (0, 20)
    uncleCount <- choose (0, 2)
    bData <- arbitrary
    bTransactions <- vectorOf txCount arbitrary
    bUncles <- vectorOf uncleCount arbitrary

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
        nonce <- unboxPI <$> arbitrary
        gasPrice <- unboxPI <$> arbitrary
        gasLimit <- arbitrary `suchThat` (> gasPrice)
        value <- unboxPI <$> arbitrary
        prvKey <- arbitrary
        isMessage <- arbitrary :: Gen Bool
        chainId <- arbitrary
        md <- arbitrary
        case isMessage of
          True -> do
            to <- arbitrary
            txData <- arbitrary
            return . unsafePerformIO $
              createChainMessageTX nonce gasPrice gasLimit to value txData chainId md prvKey
          False -> do
            contractCode <- arbitrary
            return . unsafePerformIO $
              createChainContractCreationTX nonce gasPrice gasLimit value contractCode chainId md prvKey

instance Arbitrary RawTransaction where
  arbitrary =
    txAndTime2RawTX <$> arbitrary
      <*> arbitrary
      <*> arbitrary
      <*> arbitrary

