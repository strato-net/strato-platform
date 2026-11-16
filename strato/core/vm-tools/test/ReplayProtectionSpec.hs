{-# LANGUAGE OverloadedStrings #-}

module ReplayProtectionSpec (spec) where

import Blockchain.Bagger.Transactions
import Blockchain.Data.RLP
import Blockchain.Data.Transaction (whoSignedThisTransaction)
import Blockchain.Data.TransactionDef (Transaction (..))
import Blockchain.Forks (forkNotScheduled, replayProtectionForkBlock)
import Blockchain.Strato.Model.Code (Code (..))
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Test.Hspec

-- Published EIP-155 signing example, chain ID 1.
eip155Transaction :: Transaction
eip155Transaction =
  case B16.decode "f86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83" of
    Right bytes -> rlpDecode $ rlpDeserialize bytes
    Left err -> error err

spec :: Spec
spec = describe "transaction replay protection" $ do
  it "recovers the published EIP-155 signer and signed chain ID" $ do
    chainId eip155Transaction `shouldBe` Just 1
    whoSignedThisTransaction eip155Transaction `shouldBe` Just 0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f
    transactionChainIdValid 1 eip155Transaction `shouldBe` True
    transactionChainIdValid 2 eip155Transaction `shouldBe` False
  it "cannot change the signed chain ID while preserving the sender" $
    whoSignedThisTransaction eip155Transaction {chainId = Just 2}
      `shouldNotBe` whoSignedThisTransaction eip155Transaction
  it "rejects legacy signatures with either recovery ID" $
    map (transactionChainIdValid 1 . legacyTransaction) [0, 1] `shouldBe` [False, False]
  it "requires a matching chain ID for native calls and contract creation" $
    mapM_ (\tx -> do
      transactionChainIdValid 1 tx `shouldBe` True
      transactionChainIdValid 2 tx `shouldBe` False
      transactionChainIdValid 1 tx {chainId = Nothing} `shouldBe` False
    ) [tx | ver <- [0, 1], tx <-
      [ MessageTX 0 1000000 1 "ping" ["7"] "mercata" (Just 1) 0 0 27 ver B.empty
      , ContractCreationTX 0 1000000 "Example" [] "mercata" (Code "contract Example {}") (Just 1) 0 0 27 ver
      ]]
  it "round-trips the actual helium and upquark chain IDs without truncation" $
    mapM_ (\cid -> do
      let tx = eip155Transaction {chainId = Just cid}
          decoded = rlpDecode $ rlpDeserialize $ rlpSerialize $ rlpEncode tx
      chainId decoded `shouldBe` Just cid
      transactionChainIdValid cid decoded `shouldBe` True
      transactionChainIdValid (cid + 1) decoded `shouldBe` False
    ) [195049586845898, 123354377739506]
  it "keeps public fork heights unscheduled and enables new networks at genesis" $ do
    replayProtectionForkBlock 114784819836269 `shouldBe` forkNotScheduled
    replayProtectionForkBlock 33056204878082667 `shouldBe` forkNotScheduled
    replayProtectionForkBlock 42 `shouldBe` 0
    replayProtectionForkBlock 7381244120123405172 `shouldBe` 10000
  where
    legacyTransaction recoveryId =
      rlpDecode $ rlpDeserialize $ rlpSerialize $ rlpEncode eip155Transaction {chainId = Nothing, v = recoveryId}
