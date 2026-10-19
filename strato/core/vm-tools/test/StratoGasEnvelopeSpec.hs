{-# LANGUAGE OverloadedStrings #-}

module StratoGasEnvelopeSpec (spec) where

import Blockchain.Bagger.Transactions (envelopeRejection)
import Blockchain.Data.RLP
import Blockchain.Data.Transaction (transactionHash, whoSignedThisTransaction)
import Blockchain.Data.TransactionDef (Transaction (..))
import Blockchain.EthConf.Model (stratoGasForkBlock)
import Blockchain.Forks (isStratoGasForkActive)
import Blockchain.Strato.Model.Keccak256 (keccak256ToHex)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Data.Maybe (isJust, isNothing)
import Test.Hspec

-- | The same key as ReplayProtectionSpec's EIP-155 example, signing EIP-1559
-- envelopes with viem (chain 1, 21000 gas, maxPriorityFeePerGas 1,
-- maxFeePerGas 2, to 0x3535…).
envelope :: B.ByteString -> Transaction
envelope hex = case B16.decode hex of
  Right bytes -> rlpDecode (RLPString bytes)
  Left err -> error err

-- nonce 9, 1 ether to 0x3535…, no data
valueTransfer :: Transaction
valueTransfer = envelope "02f86a01090102825208943535353535353535353535353535353535353535880de0b6b3a764000080c080a0c5c01a34c49dcba740135b84cd132a19b87d8efe573595a842544b356a6d0e50a040bcb371d55a4e52d4114e1b417ffc6e0c21be9e73615f8470bc958f1cc82e26"

-- nonce 10, no value, data a9059cbb
callWithData :: Transaction
callWithData = envelope "02f866010a01028252089435353535353535353535353535353535353535358084a9059cbbc001a011b80c3f43ad5fe58ebd262d935d9c892fa2a987186f6d8d50fbe7361b74e080a0278e3a6ddd81ec51fc817f11bfb0ad9fd65fa97c8c71f3f1023160d0956f589a"

legacy :: Integer -> B.ByteString -> Transaction
legacy val dat = EthereumTX 9 20000000000 21000 (Just 0x3535353535353535353535353535353535353535) val dat (Just 1) 1 1 0 0 0

legacyTransfer :: Transaction
legacyTransfer = legacy 1000000000000000000 B.empty

-- | The envelope with a different priority fee than the one signed.
tampered :: Transaction
tampered = case valueTransfer of
  e@EthereumTX {} -> e {maxPriorityFeePerGas = 2}
  e -> e

spec :: Spec
spec = describe "STRATO-gas envelope boundary" $ do
  it "decodes a viem-signed EIP-1559 envelope" $ do
    txVersion valueTransfer `shouldBe` 2
    chainId valueTransfer `shouldBe` Just 1
    nonce valueTransfer `shouldBe` 9
    maxPriorityFeePerGas valueTransfer `shouldBe` 1
    gasPrice valueTransfer `shouldBe` 2
    gasLimit valueTransfer `shouldBe` 21000
    value valueTransfer `shouldBe` 1000000000000000000
    txData valueTransfer `shouldBe` B.empty
    v valueTransfer `shouldBe` 0
    txData callWithData `shouldBe` "\xa9\x05\x9c\xbb"
    v callWithData `shouldBe` 1
  it "recovers the signer from the typed signing payload" $ do
    whoSignedThisTransaction valueTransfer `shouldBe` Just 0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f
    whoSignedThisTransaction callWithData `shouldBe` Just 0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f
    whoSignedThisTransaction tampered `shouldNotBe` Just 0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f
  it "hashes the envelope bytes, as wallets do" $ do
    keccak256ToHex (transactionHash valueTransfer) `shouldBe` "3fd5eaf8dfd430e04e42a01f0c8518c333f73e254c345fbc28d9c968ca96694b"
    keccak256ToHex (transactionHash callWithData) `shouldBe` "520e923947c94cd4f1349331c4b96201c1e0217e2251e109ff9029ba7ff9b995"
  it "round-trips through RLP and binary as an EIP-2718 string" $ do
    let roundTrip = rlpDecode . rlpDeserialize . rlpSerialize . rlpEncode
    roundTrip valueTransfer `shouldBe` valueTransfer
    roundTrip callWithData `shouldBe` callWithData
    roundTrip legacyTransfer `shouldBe` legacyTransfer
    case rlpEncode valueTransfer of
      RLPString bytes -> B.take 1 bytes `shouldBe` "\x02"
      other -> expectationFailure $ "expected an envelope string, got " ++ show other
  it "accepts only legacy envelopes before the fork" $ do
    envelopeRejection False legacyTransfer `shouldSatisfy` isNothing
    envelopeRejection False (legacy 1000000000000000000 "\xa9") `shouldSatisfy` isNothing
    envelopeRejection False valueTransfer `shouldSatisfy` isJust
    envelopeRejection False callWithData `shouldSatisfy` isJust
  it "requires a type-2 envelope for native-value transfers from the fork" $ do
    envelopeRejection True legacyTransfer `shouldSatisfy` isJust
    envelopeRejection True (legacy 0 B.empty) `shouldSatisfy` isNothing
    envelopeRejection True (legacy 1000000000000000000 "\xa9") `shouldSatisfy` isNothing
    envelopeRejection True valueTransfer `shouldSatisfy` isNothing
    envelopeRejection True callWithData `shouldSatisfy` isNothing
  it "never rejects STRATO-native transactions" $
    mapM_ (\active -> envelopeRejection active (MessageTX 0 1000000 1 "ping" ["7"] "mercata" (Just 1) 0 0 27 1 B.empty) `shouldSatisfy` isNothing) [False, True]
  it "schedules helium, leaves upquark unscheduled and new networks at genesis" $ do
    stratoGasForkBlock "helium" `shouldBe` 900000
    stratoGasForkBlock "upquark" `shouldBe` 2 ^ (62 :: Int)
    stratoGasForkBlock "forktest" `shouldBe` 0
    -- The test config is the default, upquark-shaped network.
    isStratoGasForkActive 900000 `shouldBe` False
    isStratoGasForkActive (2 ^ (62 :: Int)) `shouldBe` True
