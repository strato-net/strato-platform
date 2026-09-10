{-# LANGUAGE OverloadedStrings #-}

-- | Tests for the canonical receipts trie shape introduced in PR 2 of the
-- proof-based bridge withdrawals work. See the Phase 0 spec at
-- design-documents/proof-based-withdrawals-phase0.md, §6.
module ReceiptSpec (spec) where

import Blockchain.Data.RLP
import Blockchain.Data.Receipt
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Verification (receiptsVerificationValue)
import qualified Data.ByteString as B
import SolidVM.Model.TypedArg
import Test.Hspec

addr :: Address
addr = 0xdeadbeef

withdrawalLog :: ReceiptLog
withdrawalLog =
  ReceiptLog
    addr
    "Withdrawal"
    [ TAInt 42, -- nonce
      TAInt 1, -- externalChainId
      TAAddress 0x1111111111111111111111111111111111111111, -- externalToken
      TAAddress 0x2222222222222222222222222222222222222222, -- externalRecipient
      TAInt 1000000000000000000, -- externalTokenAmount (1e18)
      TAAddress 0x3333333333333333333333333333333333333333, -- stratoSender
      TAAddress 0x4444444444444444444444444444444444444444, -- stratoToken
      TAInt 1000000000000000000 -- stratoTokenAmount
    ]

sampleReceipt :: Receipt
sampleReceipt = Receipt ReceiptSuccess 21000 [withdrawalLog]

spec :: Spec
spec = do
  describe "TypedArg RLP encoding" $ do
    it "TAInt encodes as RLP integer" $
      rlpSerialize (rlpEncode (TAInt 42)) `shouldBe` rlpSerialize (rlpEncode (42 :: Integer))

    it "TABool True encodes as integer 1" $
      rlpSerialize (rlpEncode (TABool True)) `shouldBe` rlpSerialize (rlpEncode (1 :: Integer))

    it "TABool False encodes as integer 0" $
      rlpSerialize (rlpEncode (TABool False)) `shouldBe` rlpSerialize (rlpEncode (0 :: Integer))

    it "TAAddress encodes as a 20-byte string" $ do
      let bs = rlpSerialize (rlpEncode (TAAddress addr))
      -- RLP-encoded 20-byte string starts with 0x94 followed by the 20 bytes
      B.head bs `shouldBe` 0x94
      B.length bs `shouldBe` 21

    it "TAString encodes as UTF-8 bytes" $
      rlpSerialize (rlpEncode (TAString "hello")) `shouldBe` rlpSerialize (rlpEncode ("hello" :: B.ByteString))

    it "TAArray encodes as RLP list of typed args" $ do
      let arr = TAArray [TAInt 1, TAInt 2, TAInt 3]
      let expected = RLPArray [rlpEncode (1 :: Integer), rlpEncode (2 :: Integer), rlpEncode (3 :: Integer)]
      rlpSerialize (rlpEncode arr) `shouldBe` rlpSerialize expected

    it "TAStruct encodes by-position, dropping field names" $ do
      let s = TAStruct [("amount", TAInt 100), ("recipient", TAAddress addr)]
      let expected = RLPArray [rlpEncode (100 :: Integer), rlpEncode addr]
      rlpSerialize (rlpEncode s) `shouldBe` rlpSerialize expected

  describe "ReceiptStatus RLP encoding" $ do
    it "ReceiptSuccess encodes as integer 1" $
      rlpSerialize (rlpEncode ReceiptSuccess) `shouldBe` rlpSerialize (rlpEncode (1 :: Integer))

    it "ReceiptFailure encodes as integer 0" $
      rlpSerialize (rlpEncode ReceiptFailure) `shouldBe` rlpSerialize (rlpEncode (0 :: Integer))

  describe "ReceiptLog RLP encoding" $ do
    it "round-trips structure (typed-arg shape preserved as bytes)" $ do
      let bytes = rlpSerialize (rlpEncode withdrawalLog)
      let decoded = rlpDecode (rlpDeserialize bytes) :: ReceiptLog
      rlogContractAddress decoded `shouldBe` rlogContractAddress withdrawalLog
      rlogEventName decoded `shouldBe` rlogEventName withdrawalLog
      length (rlogArgs decoded) `shouldBe` length (rlogArgs withdrawalLog)

  describe "Receipt RLP encoding" $ do
    it "Receipt is a 3-element RLP list" $ do
      case rlpEncode sampleReceipt of
        RLPArray xs -> length xs `shouldBe` 3
        _ -> expectationFailure "expected RLPArray"

    it "encodes deterministically (same input -> same bytes)" $
      rlpSerialize (rlpEncode sampleReceipt)
        `shouldBe` rlpSerialize (rlpEncode sampleReceipt)

  describe "receiptsVerificationValue" $ do
    it "returns the empty-trie root for an empty receipts list" $
      receiptsVerificationValue [] `shouldBe` MP.emptyTriePtr

    it "is deterministic across repeated invocations" $
      receiptsVerificationValue [sampleReceipt]
        `shouldBe` receiptsVerificationValue [sampleReceipt]

    it "returns a different root when receipts differ" $ do
      let alt = sampleReceipt {receiptGasUsed = 21001}
      receiptsVerificationValue [sampleReceipt]
        `shouldNotBe` receiptsVerificationValue [alt]

    it "is order-sensitive (txIndex matters)" $ do
      let r2 = sampleReceipt {receiptGasUsed = 99}
      receiptsVerificationValue [sampleReceipt, r2]
        `shouldNotBe` receiptsVerificationValue [r2, sampleReceipt]
