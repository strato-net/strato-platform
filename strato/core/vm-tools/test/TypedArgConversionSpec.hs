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
import Data.IORef (newIORef)
import qualified Data.Map as M
import qualified Data.Set as S
import qualified Data.Vector as V
import SolidVM.Model.Event (Event (..))
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.TypedArg
import SolidVM.Model.Value (Value (..), Variable (..))
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
            txVersion = 0,
            attribution = ""
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
      erRemovedValidators = [],
      erStakeUpdates = M.empty
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
      valueToTypedArg (SInteger 42) `shouldReturn` Just (TAInt 42)

    it "converts SBool True to TABool True" $
      valueToTypedArg (SBool True) `shouldReturn` Just (TABool True)

    it "converts SBool False to TABool False" $
      valueToTypedArg (SBool False) `shouldReturn` Just (TABool False)

    it "converts SAddress to TAAddress" $
      valueToTypedArg (SAddress testAddr False) `shouldReturn` Just (TAAddress testAddr)

    it "converts SString to TAString" $
      valueToTypedArg (SString "hello") `shouldReturn` Just (TAString "hello")

    it "converts SBytes to TABytes" $
      valueToTypedArg (SBytes "raw") `shouldReturn` Just (TABytes "raw")

    it "converts SEnumVal to TAInt of its index" $
      valueToTypedArg (SEnumVal "MyEnum" "VariantA" 7) `shouldReturn` Just (TAInt 7)

    it "returns Nothing for SNULL" $
      valueToTypedArg SNULL `shouldReturn` Nothing

    it "converts SArray of primitives to TAArray (reading IORefs)" $ do
      ref1 <- newIORef (SInteger 1)
      ref2 <- newIORef (SInteger 2)
      let arr = SArray (V.fromList [Variable ref1, Variable ref2])
      valueToTypedArg arr `shouldReturn` Just (TAArray [TAInt 1, TAInt 2])

    it "converts SStruct to TAStruct (canonically ordered by field name)" $ do
      refA <- newIORef (SInteger 7)
      refB <- newIORef (SAddress testAddr False)
      let structVal = SStruct "S" (M.fromList [("a", Variable refA), ("b", Variable refB)])
      valueToTypedArg structVal
        `shouldReturn` Just (TAStruct [("a", TAInt 7), ("b", TAAddress testAddr)])

  describe "txRunResultToReceipt" $ do
    it "successful tx → ReceiptSuccess with gas = limit - remaining" $ do
      rec <- txRunResultToReceipt successTrr
      receiptStatus rec `shouldBe` ReceiptSuccess
      receiptGasUsed rec `shouldBe` (21000 - 5000)
      receiptLogs rec `shouldBe` []

    it "pre-execution failure → ReceiptFailure with gas = limit" $ do
      let trr = successTrr {trrResult = Left (TFNonceMismatch 0 1 (makeOutputTx 21000))}
      rec <- txRunResultToReceipt trr
      receiptStatus rec `shouldBe` ReceiptFailure
      receiptGasUsed rec `shouldBe` 21000

    it "execution exception → ReceiptFailure with gas = limit" $ do
      let trr = successTrr {trrResult = Right (successResults {erException = Just (Right undefined)})}
      rec <- txRunResultToReceipt trr
      receiptStatus rec `shouldBe` ReceiptFailure
      receiptGasUsed rec `shouldBe` 21000

    it "emitted event becomes a ReceiptLog" $ do
      let ev =
            Event
              { evBlockHash = zeroHash,
                evTxHash = zeroHash,
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
      rec <- txRunResultToReceipt trr
      length (receiptLogs rec) `shouldBe` 1
      case receiptLogs rec of
        [log_] -> do
          rlogContractAddress log_ `shouldBe` testAddr
          rlogEventName log_ `shouldBe` "Withdrawal"
          rlogArgs log_ `shouldBe` [TAInt 1, TAAddress 0xdead]
        _ -> expectationFailure "expected exactly one log"

    it "event with array arg is recovered through IORef deref" $ do
      ref1 <- newIORef (SInteger 11)
      ref2 <- newIORef (SInteger 22)
      let arrVal = SArray (V.fromList [Variable ref1, Variable ref2])
          ev =
            Event
              { evBlockHash = zeroHash,
                evTxHash = zeroHash,
                evTxSender = testAddr,
                evContractName = "C",
                evContractAddress = testAddr,
                evName = "BatchSent",
                evArgs = [("ids", arrVal, "[11,22]", SVMType.Array (SVMType.Int (Just False) Nothing) Nothing)]
              }
          trr = successTrr {trrResult = Right (successResults {erEvents = [ev]})}
      rec <- txRunResultToReceipt trr
      case receiptLogs rec of
        [log_] -> rlogArgs log_ `shouldBe` [TAArray [TAInt 11, TAInt 22]]
        _ -> expectationFailure "expected exactly one log"
