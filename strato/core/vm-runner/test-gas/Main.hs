module Main (main) where

import Blockchain.BlockChain (transactionExecutionGas, transactionGasUsed)
import qualified Blockchain.Data.TransactionDef as TD
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Gas (Gas (..))
import qualified Data.ByteString as B
import Test.Hspec

main :: IO ()
main = hspec $ do
  describe "Ethereum transaction gas accounting" $ do
    it "meters SolidVM with the signed transaction gas limit" $
      transactionExecutionGas ethereumTransaction `shouldBe` Gas 150000

    it "reports the gas consumed from that same limit" $
      transactionGasUsed ethereumTransaction 28874 `shouldBe` 121126

    it "cannot expose a negative receipt value as uint256 underflow" $
      transactionGasUsed ethereumTransaction 400000 `shouldBe` 0

ethereumTransaction :: TD.Transaction
ethereumTransaction =
  TD.EthereumTX
    0
    1
    150000
    (Just (1 :: Address))
    0
    B.empty
    (Just 31337)
    0
    0
    0
