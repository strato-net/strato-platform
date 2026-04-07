{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.ValueSpec where

-- import Data.Word

import BlockApps.Solidity.Type
import BlockApps.Solidity.Value
import qualified Data.IntMap as I
import qualified LabeledError
import Test.Hspec

{-# ANN module ("HLint: ignore Redundant do" :: String) #-}

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

spec :: Spec
spec = do
  describe "Convert bytes to values" $ do
    it "should convert Bool - True" $ do
      let b = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "01"
          result = bytesToSimpleValue b TypeBool
      putStrLn $ show b
      result `shouldBe` (Just $ ValueBool True)
    it "should convert Bool - False" $ do
      let b = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "00"
          result = bytesToSimpleValue b TypeBool
      putStrLn $ show b
      result `shouldBe` (Just $ ValueBool False)
    it "should convert UInt - 123" $ do
      let b = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "7B"
          result = bytesToSimpleValue b $ TypeInt False Nothing
      putStrLn $ show b
      result `shouldBe` (Just $ ValueInt False Nothing 123)
    it "should convert Int - 123" $ do
      let b = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "7B"
          result = bytesToSimpleValue b $ TypeInt True Nothing
      putStrLn $ show b
      result `shouldBe` (Just $ ValueInt True Nothing 123)

    it "should convert UInt Array - [1, 2, 3]" $ do
      let val = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000FF000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003"
          result = bytesToValue val $ TypeArrayDynamic $ SimpleType $ TypeInt False Nothing
          expected =
            I.fromList
              [ (0, SimpleValue $ ValueInt False Nothing 255),
                (1, SimpleValue $ ValueInt False Nothing 1),
                (2, SimpleValue $ ValueInt False Nothing 2),
                (3, SimpleValue $ ValueInt False Nothing 3)
              ]
      putStrLn $ show val
      result `shouldBe` (Just $ ValueArrayDynamic expected)
    it "should convert Int Array - [1, 2, 3]" $ do
      let val = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000FF000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003"
          result = bytesToValue val $ TypeArrayDynamic $ SimpleType $ TypeInt True Nothing
          expected =
            I.fromList
              [ (0, SimpleValue $ ValueInt True Nothing 255),
                (1, SimpleValue $ ValueInt True Nothing 1),
                (2, SimpleValue $ ValueInt True Nothing 2),
                (3, SimpleValue $ ValueInt True Nothing 3)
              ]
      putStrLn $ show val
      result `shouldBe` (Just $ ValueArrayDynamic expected)
