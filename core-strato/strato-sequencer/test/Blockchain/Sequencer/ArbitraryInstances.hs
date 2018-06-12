{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.Sequencer.ArbitraryInstances where

import           Data.DeriveTH
import           Test.QuickCheck

import           Blockchain.Data.ArbitraryInstances ()
import           Blockchain.Data.GenesisInfo
import           Blockchain.Sequencer.Event

derive makeArbitrary ''IngestEvent
derive makeArbitrary ''IngestTx
derive makeArbitrary ''IngestBlock
derive makeArbitrary ''IngestGenesis
derive makeArbitrary ''SequencedBlock
derive makeArbitrary ''OutputEvent
derive makeArbitrary ''OutputTx
derive makeArbitrary ''OutputBlock
derive makeArbitrary ''OutputGenesis

instance Arbitrary CodeInfo where
  arbitrary = CodeInfo <$> arbitrary <*> arbitrary <*> arbitrary

instance Arbitrary AccountInfo where
  arbitrary = NonContract <$> arbitrary <*> arbitrary

instance Arbitrary GenesisInfo where
  arbitrary = do
    parentHash <- arbitrary
    unclesHash       <- arbitrary
    coinbase         <- arbitrary
    accountInfo      <- arbitrary
    codeInfo         <- arbitrary
    transactionsRoot <- arbitrary
    receiptsRoot     <- arbitrary
    logBloom         <- arbitrary
    difficulty       <- arbitrary
    number           <- arbitrary
    gasLimit         <- arbitrary
    gasUsed          <- arbitrary
    timestamp        <- arbitrary
    extraData        <- arbitrary
    mixHash          <- arbitrary
    nonce            <- arbitrary
    chainId          <- arbitrary
    return $ GenesisInfo parentHash unclesHash coinbase
      accountInfo codeInfo transactionsRoot receiptsRoot
      logBloom difficulty number gasLimit gasUsed timestamp
      extraData mixHash nonce chainId

-- just end me fam
instance Arbitrary JsonRpcCommand where
   arbitrary = JRCGetBalance <$> arbitrary <*> arbitrary <*> arbitrary


