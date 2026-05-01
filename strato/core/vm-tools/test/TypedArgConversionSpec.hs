{-# LANGUAGE OverloadedStrings #-}

-- | Tests for value-to-TypedArg conversion and receipt construction from
-- TxRunResult, introduced in PR 4 of the proof-based bridge withdrawals work.
module TypedArgConversionSpec (spec) where

import Blockchain.Bagger.Transactions
import Blockchain.Data.ExecResults
import Blockchain.Data.Receipt
import qualified Blockchain.Data.TXOrigin as TO
import Blockchain.Data.TransactionDef (Transaction (..))
import Blockchain.Model.WrappedBlock (OutputTx (..))
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Keccak256 (zeroHash)
import qualified Data.Map as M
import qualified Data.Set as S
import SolidVM.Model.Event (Event (..))
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.TypedArg
import SolidVM.Model.Value (Value (..))
import Test.Hspec

testAddr :: Address
testAddr = 0xabcd1234

makeOutputTx :: Integer -> OutputTx
makeOutputTx gasLim =
  OutputTx
    { otOrigin = TO.Direct,
      otHash = zeroHash,
      otSigner = testAddr,
      otBaseTx =
        MessageTX
          { nonce = 0,
            gasLimit = gasLim,
            to = testAddr,
            funcName = "test",
            args = [],
            network = "test",
            chainId = Nothing,
            r = 0,
            s = 0,
            v = 0,
            txVersion = 0
          }
    }

successResults :: ExecResults
successResults =
  ExecResults
    { erRemainingTxGas = 5000,
      erRefund = 0,
      erReturnVal = Nothing,
      erTrace = [],
      erLogs = [],
      erEvents = [],
      erNewContractAddress = Nothing,
      erSuicideList = S.empty,
      erAction = Nothing,
      erException = Nothing,
      erPragmas = [],
      erNewValidators = [],
      erRemovedValidators = []
    }

successTrr :: TxRunResult
successTrr =
  TxRunResult
    { trrTransaction = makeOutputTx 21000,
      trrResult = Right successResults,
      trrTime = 0,
      trrBeforeMap = M.empty,
      trrAfterMap = M.empty,
      trrNewAddresses = []
    }

spec :: Spec
spec = do
  describe "valueToTypedArg" $ do
    it "converts SInteger to TAInt" $
      valueToTypedArg (SInteger 42) `shouldBe` Just (TAInt 42)

    it "converts SBool True to TABool True" $
      valueToTypedArg (SBool True) `shouldBe` Just (TABool True)

    it "converts SBool False to TABool False" $
      valueToTypedArg (SBool False) `shouldBe` Just (TABool False)

    it "converts SAddress to TAAddress" $
      valueToTypedArg (SAddress testAddr False) `shouldBe` Just (TAAddress testAddr)

    it "converts SString to TAString" $
      valueToTypedArg (SString "hello") `shouldBe` Just (TAString "hello")

    it "converts SBytes to TABytes" $
      valueToTypedArg (SBytes "raw") `shouldBe` Just (TABytes "raw")

    it "converts SEnumVal to TAInt of its index" $
      valueToTypedArg (SEnumVal "MyEnum" "VariantA" 7) `shouldBe` Just (TAInt 7)

    it "returns Nothing for SNULL" $
      valueToTypedArg SNULL `shouldBe` Nothing

  describe "txRunResultToReceipt" $ do
    it "successful tx → ReceiptSuccess with gas = limit - remaining" $ do
      let rec = txRunResultToReceipt successTrr
      receiptStatus rec `shouldBe` ReceiptSuccess
      receiptGasUsed rec `shouldBe` (21000 - 5000)
      receiptLogs rec `shouldBe` []

    it "pre-execution failure → ReceiptFailure with gas = limit" $ do
      let trr = successTrr {trrResult = Left (TFKnownFailedTX (makeOutputTx 21000))}
          rec = txRunResultToReceipt trr
      receiptStatus rec `shouldBe` ReceiptFailure
      receiptGasUsed rec `shouldBe` 21000

    it "execution exception → ReceiptFailure with gas = limit" $ do
      let trr = successTrr {trrResult = Right (successResults {erException = Just (Right undefined)})}
          rec = txRunResultToReceipt trr
      receiptStatus rec `shouldBe` ReceiptFailure
      receiptGasUsed rec `shouldBe` 21000

    it "emitted event becomes a ReceiptLog" $ do
      let ev =
            Event
              { evBlockHash = zeroHash,
                evTxSender = testAddr,
                evContractName = "MercataBridge",
                evContractAddress = testAddr,
                evName = "Withdrawal",
                evArgs =
                  [ ("nonce", SInteger 1, "1", SVMType.Int (Just False) Nothing),
                    ("recipient", SAddress 0xdead False, "0xdead", SVMType.Address False)
                  ]
              }
          trr = successTrr {trrResult = Right (successResults {erEvents = [ev]})}
          rec = txRunResultToReceipt trr
      length (receiptLogs rec) `shouldBe` 1
      case receiptLogs rec of
        [log_] -> do
          rlogContractAddress log_ `shouldBe` testAddr
          rlogEventName log_ `shouldBe` "Withdrawal"
          rlogArgs log_ `shouldBe` [TAInt 1, TAAddress 0xdead]
        _ -> expectationFailure "expected exactly one log"
