{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.Sequencer.ArbitraryInstances where

import           Data.DeriveTH
import           Test.QuickCheck

import           Blockchain.Data.ArbitraryInstances ()
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Enode
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
derive makeArbitrary ''ChainInfo
derive makeArbitrary ''Enode
derive makeArbitrary ''IPAddress

-- just end me fam
instance Arbitrary JsonRpcCommand where
   arbitrary = JRCGetBalance <$> arbitrary <*> arbitrary <*> arbitrary
