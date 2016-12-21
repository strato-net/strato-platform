module Main where

import Prelude
import Test.Tasty
import Test.Tasty.Runners
import Test.Tasty.HUnit
import Test.Tasty.QuickCheck
import qualified BlockApps.ECRecover.BytesFormat as A
import qualified BlockApps.ECRecover.IntegerFormat as D
import qualified Main.Samples as B
import qualified Control.Parallel.Strategies as C


main =
  defaultMain (testGroup "" [bytes, integer])
  where
    bytes =
      testGroup "bytes" $
      [
        testCase "Sequential correctness" $
        forM_ B.transactions_bytes $ \transaction -> do
          assertEqual "" (Right B.publicKey) ((uncurry4 A.recoverCompressed) transaction)
        ,
        testCase "Parallel correctness" $
        assertBool "" (all ((==) (Right B.publicKey)) (C.parMap C.rdeepseq (uncurry4 A.recoverCompressed) B.transactions_bytes))
      ]
    integer =
      testGroup "integer" $
      [
        testCase "Sequential correctness" $
        forM_ B.transactions_integer $ \transaction -> do
          assertEqual "" (Right B.publicKey) ((uncurry4 D.recoverCompressed) transaction)
        ,
        testCase "Parallel correctness" $
        assertBool "" (all ((==) (Right B.publicKey)) (C.parMap C.rdeepseq (uncurry4 D.recoverCompressed) B.transactions_integer))
      ]

uncurry4 :: (a -> b -> c -> d -> e) -> (a, b, c, d) -> e
uncurry4 fn (a, b, c, d) =
  fn a b c d
