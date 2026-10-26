{-# LANGUAGE OverloadedStrings #-}

module SQLSpec (spec) where

import Blockchain.Slipstream.SQL (isRecoverableSqlState)
import Test.Hspec

spec :: Spec
spec = do
  describe "isRecoverableSqlState" $ do
    it "retries statement errors but propagates connection, rollback, and cancellation errors" $ do
      isRecoverableSqlState "42703" `shouldBe` True
      isRecoverableSqlState "23505" `shouldBe` True
      isRecoverableSqlState "08006" `shouldBe` False
      isRecoverableSqlState "40001" `shouldBe` False
      isRecoverableSqlState "57014" `shouldBe` False
