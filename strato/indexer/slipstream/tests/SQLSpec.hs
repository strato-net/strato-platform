{-# LANGUAGE OverloadedStrings #-}

module SQLSpec (spec) where

import Blockchain.Slipstream.QueryFormatHelper
  ( dollarQuote, sanitizeCreator, wrapEscapeDouble, wrapEscapeSingleQ )
import Blockchain.Slipstream.SQL (isRecoverableSqlState)
import Test.Hspec

spec :: Spec
spec = do
  describe "generated SQL quoting" $ do
    it "quotes identifiers and literals without mixing their escape rules" $ do
      let name = "creator'\"?;--$$"
      wrapEscapeDouble name `shouldBe` "\"creator'\"\"??;--$$\""
      wrapEscapeSingleQ name `shouldBe` "'creator''\"??;--$$'"
    it "chooses a dollar delimiter absent from the body" $
      dollarQuote "body $slipstream_0$ end" `shouldBe`
        "$slipstream_1$body $slipstream_0$ end$slipstream_1$"

  describe "isRecoverableSqlState" $ do
    it "retries statement errors but propagates connection, rollback, and cancellation errors" $ do
      isRecoverableSqlState "42703" `shouldBe` True
      isRecoverableSqlState "23505" `shouldBe` True
      isRecoverableSqlState "08006" `shouldBe` False
      isRecoverableSqlState "40001" `shouldBe` False
      isRecoverableSqlState "57014" `shouldBe` False

  describe "sanitizeCreator" $ do
    it "keeps the characters legitimate creators use" $ do
      sanitizeCreator "strato-eth-usdst-arb-bb7d2712" `shouldBe` "strato-eth-usdst-arb-bb7d2712"
      sanitizeCreator "a.b_c@d-E9" `shouldBe` "a.b_c@d-E9"
    it "neutralises quotes, placeholders and statement separators" $ do
      sanitizeCreator "r79x'; COPY t FROM PROGRAM 'id'; --" `shouldBe` "r79x___COPY_t_FROM_PROGRAM__id___--"
      sanitizeCreator "a\"b?c\\d\ne" `shouldBe` "a_b_c_d_e"
