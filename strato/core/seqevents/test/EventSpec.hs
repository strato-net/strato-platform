{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

import Blockchain.Data.BlockHeader
import Blockchain.Data.RLP (rlpDecode, rlpDeserialize, rlpEncode, rlpSerialize)
import qualified Blockchain.Data.Transaction as TX
import Blockchain.Model.WrappedBlock
import Blockchain.Sequencer.CallSpec
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.HexData (HexData (..))
import Blockchain.Sequencer.TxCallObject (TxCallObject (..))
import Blockchain.Strato.Model.Address (Address (..))
import qualified Data.ByteString as B
import Data.Binary
import qualified Data.Aeson as Ae
import qualified Data.Text as T
import Test.Hspec
import Test.QuickCheck

main :: IO ()
main = hspec spec

binaryFidelity :: (Eq a, Show a, Binary a) => a -> Expectation
binaryFidelity x = decode (encode x) `shouldBe` x

genText :: Gen T.Text
genText = T.pack <$> arbitrary

-- The Binary Transaction wire format cannot represent zero or negative
-- chainIds (they decode as Nothing), so only generate what round-trips.
genChainId :: Gen (Maybe Integer)
genChainId = oneof [pure Nothing, Just . getPositive <$> arbitrary]

-- Binary Transaction goes through RLP, the canonical Ethereum wire format,
-- which is lossy for arbitrary field values (e.g. EIP-155 entangles v and
-- chainId). One round trip projects a generated transaction onto the
-- representable domain; fidelity is then tested on canonical values.
canonicalTx :: TX.Transaction -> TX.Transaction
canonicalTx = rlpDecode . rlpDeserialize . rlpSerialize . rlpEncode

instance Arbitrary TX.Transaction where
  arbitrary = canonicalTx <$> oneof [msgTx, createTx, ethTx]
    where
      -- v must be a recovery id and txVersion a valid EIP-2718 type byte,
      -- otherwise rlpEncode/rlpDecode reject the transaction outright.
      genV = elements [0, 1]
      genTxVersion = elements [0, 1]
      msgTx =
        TX.MessageTX
          <$> arbitrary <*> arbitrary <*> arbitrary <*> genText <*> listOf genText
          <*> genText <*> genChainId <*> arbitrary <*> arbitrary <*> genV <*> genTxVersion
      createTx =
        TX.ContractCreationTX
          <$> arbitrary <*> arbitrary <*> genText <*> listOf genText <*> genText
          <*> arbitrary <*> genChainId <*> arbitrary <*> arbitrary <*> genV <*> genTxVersion
      ethTx =
        TX.EthereumTX
          <$> arbitrary <*> arbitrary <*> arbitrary <*> arbitrary <*> arbitrary
          <*> (B.pack <$> arbitrary) <*> genChainId <*> arbitrary <*> arbitrary <*> genV

instance Arbitrary IngestTx where
  arbitrary = IngestTx <$> arbitrary <*> arbitrary

instance Arbitrary IngestBlock where
  arbitrary = IngestBlock <$> arbitrary <*> arbitrary <*> arbitrary <*> arbitrary

instance Arbitrary OutputTx where
  arbitrary = OutputTx <$> arbitrary <*> arbitrary <*> arbitrary <*> arbitrary

instance Arbitrary SequencedBlock where
  arbitrary = SequencedBlock <$> arbitrary <*> arbitrary <*> arbitrary <*> arbitrary <*> arbitrary

instance Arbitrary OutputBlock where
  arbitrary = OutputBlock <$> arbitrary <*> arbitrary <*> arbitrary <*> arbitrary

spec :: Spec
spec = parallel $ do
  describe "Transaction" $ do
    it "should be serializable and deserializable" $
      property $
        \x -> binaryFidelity (x :: TX.Transaction)
  describe "BlockHeader" $ do
    it "should be serializable and deserializable" $
      property $
        \x -> binaryFidelity (x :: BlockHeader)
  describe "IngestTx" $ do
    it "should be serializable and deserializable" $
      property $ do
        \x -> binaryFidelity (x :: IngestTx)
  describe "IngestBlock" $ do
    it "should be serializable and deserializable" $
      property $ do
        \x -> binaryFidelity (x :: IngestBlock)
  describe "SequencedBlock" $ do
    it "should be serializable and deserializable" $
      property $ do
        \x -> binaryFidelity (x :: SequencedBlock)
  describe "OutputTx" $ do
    it "should be serializable and deserializable" $
      property $ do
        \x -> binaryFidelity (x :: OutputTx)
  describe "OutputBlock" $ do
    it "should be serializable and deserializable" $
      property $ do
        \x -> binaryFidelity (x :: OutputBlock)
  describe "JsonRpcCommand" $ do
    let txObj = TxCallObject (Address 5) (Just (Address 9)) "0x2dc6c0" "0x0" "0x0" (HexData $ B.pack [1, 2, 3, 4])
        createObj = TxCreateObject (Address 5) "0x2dc6c0" "0x0" "SimpleStorage" "contract SimpleStorage { uint x; }" ["42"]
        funcCallObj = TxFuncCallObject (Address 5) (Address 9) "0x2dc6c0" "0x0" "transfer" ["\"deadbeef00000000000000000000000000000000\"", "42"]
    it "round-trips JRCCallV2 with a call spec" $
      property $
        \h -> binaryFidelity $ JRCCallV2 (SpecCall txObj) (h :: Maybe BlockHeader) "id1"
    it "round-trips JRCCallV2 with a creation spec" $
      property $
        \h -> binaryFidelity $ JRCCallV2 (SpecCreate createObj) (h :: Maybe BlockHeader) "id2"
    it "round-trips JRCTraceCall" $
      property $
        \h -> binaryFidelity $ JRCTraceCall (SpecCall txObj) (h :: Maybe BlockHeader) (TraceOptions True) "id3"
    it "round-trips JRCTraceBlockTxs" $
      property $
        \bh txs -> binaryFidelity $ JRCTraceBlockTxs (bh :: BlockHeader) (take 3 txs :: [TX.Transaction]) Nothing (TraceOptions False) "id4"
    it "round-trips JRCSimulate" $
      property $
        \h -> binaryFidelity $ JRCSimulate [[SpecCall txObj], [SpecCreate createObj, SpecCall txObj]] (h :: Maybe BlockHeader) "id5"
    it "round-trips JRCCallV2 with a direct function-call spec" $
      property $
        \h -> binaryFidelity $ JRCCallV2 (SpecFuncCall funcCallObj) (h :: Maybe BlockHeader) "id7"
    it "round-trips JRCTraceCall with a direct function-call spec" $
      property $
        \h -> binaryFidelity $ JRCTraceCall (SpecFuncCall funcCallObj) (h :: Maybe BlockHeader) (TraceOptions False) "id8"
    it "round-trips JRCSimulate with a direct function-call spec" $
      property $
        \h -> binaryFidelity $ JRCSimulate [[SpecFuncCall funcCallObj, SpecCreate createObj]] (h :: Maybe BlockHeader) "id9"
  describe "CallSpec JSON" $ do
    let txObj = TxCallObject (Address 5) (Just (Address 9)) "0x2dc6c0" "0x0" "0x0" (HexData $ B.pack [1, 2, 3, 4])
        createObj = TxCreateObject (Address 5) "0x2dc6c0" "0x0" "SimpleStorage" "contract SimpleStorage { uint x; }" ["42"]
        funcCallObj = TxFuncCallObject (Address 5) (Address 9) "0x2dc6c0" "0x0" "transfer" ["\"deadbeef00000000000000000000000000000000\"", "42"]
        jsonFidelity cs = Ae.decode (Ae.encode cs) `shouldBe` Just (cs :: CallSpec)
    it "round-trips SpecCall through JSON" $
      jsonFidelity $ SpecCall txObj
    it "round-trips SpecCreate through JSON" $
      jsonFidelity $ SpecCreate createObj
    it "round-trips SpecFuncCall through JSON" $
      jsonFidelity $ SpecFuncCall funcCallObj
  describe "JsonRpcResponse" $ do
    it "round-trips SuccessJson" $
      binaryFidelity $ SuccessJson "id6" (B.pack [123, 125])
