{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.Sequencer.ArbitraryInstances where

import Data.DeriveTH
import Test.QuickCheck

import Blockchain.Data.ArbitraryInstances
import Blockchain.Sequencer.Event

derive makeArbitrary ''IngestEvent
derive makeArbitrary ''IngestTx
derive makeArbitrary ''IngestBlock
derive makeArbitrary ''SequencedBlock
derive makeArbitrary ''OutputEvent
derive makeArbitrary ''OutputTx
derive makeArbitrary ''OutputBlock

-- just end me fam
instance Arbitrary JsonRpcCommand where
   arbitrary = JRCGetBalance <$> arbitrary <*> arbitrary <*> arbitrary


