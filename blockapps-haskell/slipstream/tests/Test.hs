{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Test where

import Test.Hspec
import Slipstream.Converter

{-
Test: Message conversion to statediff is successful and accurate
Test: Failure to receive kafka message generates correct retry message and correct logging
Test: Failed message conversion generates correct error message
Test: db writes are successful (test our common pre-established format)
Test: when db queries fail, error message is correct and is logged correctly
Create some formal tests to confirm correct db writes in each of the tables
Test: when db writes fail, error message is correct and is logged correctly
Test: indexes are accurate
-}

main :: IO ()
main = hspec $ do
  describe "" $ do
    it "test1" $ do
      let x = defaultMaxB
      let y = defaultMaxB
      x `shouldBe` y
