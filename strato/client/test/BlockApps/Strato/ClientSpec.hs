{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings, TypeApplications #-}

module BlockApps.Strato.ClientSpec where

import Data.Either
import Data.LargeWord
import Generic.Random.Generic
import Network.HTTP.Client
import Servant.Client
import Test.Hspec
import Test.Hspec.QuickCheck
import Test.QuickCheck

import BlockApps.Strato.Client
import BlockApps.Strato.Types

spec :: Spec
spec
  = modifyMaxSuccess (const 10)
  . beforeAll (newManager defaultManagerSettings) $ do
  describe "getTxsLast" $
    it "works" $ \ mgr -> do
      txs <- runClientM (getTxsLast 10) (ClientEnv mgr stratoDev)
      txs `shouldSatisfy` isRight
  describe "getTxsFilter" $ do
    it "works with a nonempty filter" $ \ mgr -> do
      let nonEmptyParams = genericArbitrary uniform `suchThat` (/= txsFilterParams)
      forAll nonEmptyParams $ \ params -> do
          txs <- runClientM (getTxsFilter params) (ClientEnv mgr stratoDev)
          txs `shouldSatisfy` isRight
    it "doesn't work with an empty filter" $ \ mgr -> do
      txs <- runClientM
        (getTxsFilter txsFilterParams)
        (ClientEnv mgr stratoDev)
      txs `shouldSatisfy` isLeft
  describe "getBlocksLast" $
    it "works" $ \ mgr -> do
      txs <- runClientM (getBlocksLast 10) (ClientEnv mgr stratoDev)
      txs `shouldSatisfy` isRight
  describe "getBlocksFilter" $ do
    it "works with a nonempty filter" $ \ mgr -> do
      let
        nonEmptyParams = genericArbitrary uniform `suchThat` (/= blocksFilterParams)
      forAll nonEmptyParams $ \ params -> do
          blocks <- runClientM
            (getBlocksFilter params)
            (ClientEnv mgr stratoDev)
          blocks `shouldSatisfy` isRight
    it "doesn't work with an empty filter" $ \ mgr -> do
      blocks <- runClientM
        (getBlocksFilter blocksFilterParams)
        (ClientEnv mgr stratoDev)
      blocks `shouldSatisfy` isLeft
  describe "getAccountsFilter" $ do
    it "works with a nonempty filter" $ \ mgr -> do
      let
        nonEmptyParams =
          genericArbitrary uniform `suchThat` (/= accountsFilterParams)
      forAll nonEmptyParams $ \ params -> do
          accts <- runClientM
            (getAccountsFilter params)
            (ClientEnv mgr stratoDev)
          accts `shouldSatisfy` isRight
    it "doesn't work with an empty filter" $ \ mgr -> do
      accts <- runClientM
        (getAccountsFilter accountsFilterParams)
        (ClientEnv mgr stratoDev)
      accts `shouldSatisfy` isLeft
  describe "getDifficulty" $
    it "works" $ \ mgr -> do
      diff <- runClientM getDifficulty (ClientEnv mgr stratoDev)
      diff `shouldSatisfy` isRight
  describe "getTotalTx" $
    it "works" $ \ mgr -> do
      diff <- runClientM getTotalTx (ClientEnv mgr stratoDev)
      diff `shouldSatisfy` isRight
  describe "getStorage" $
    it "works" $ \ mgr ->
      forAll (Just <$> arbitrary) $ \ addr -> do
        str <- runClientM (getStorage addr) (ClientEnv mgr stratoDev)
        str `shouldSatisfy` isRight
  describe "postTx" $
    it "works" $ \ mgr ->
      forAll arbitrary $ \ tx -> do
        resp <- runClientM (postTx tx) (ClientEnv mgr stratoDev)
        resp `shouldSatisfy` isRight
  describe "postFaucet" $
    it "works" $ \ mgr ->
      forAll arbitrary $ \ addr -> do
        resp <- runClientM (postFaucet addr) (ClientEnv mgr stratoDev)
        resp `shouldSatisfy` isRight
  describe "postFaucets" $
    it "works" $ \ mgr ->
      forAll arbitrary $ \ addrs -> do
        resp <- runClientM (postFaucets addrs) (ClientEnv mgr stratoDev)
        resp `shouldSatisfy` isRight
  let src = Src "contract f {uint global; function f() {global=7;}}"
  describe "postSolc" $
    it "works" $ \ mgr -> do
      resp <- runClientM (postSolc src) (ClientEnv mgr stratoDev)
      resp `shouldSatisfy` isRight
  describe "postExtabi" $
    it "works" $ \ mgr -> do
      resp <- runClientM (postExtabi src) (ClientEnv mgr stratoDev)
      resp `shouldSatisfy` isRight

-- orphans

instance Arbitrary TransactionType where arbitrary = genericArbitrary uniform
instance Arbitrary Addresses where arbitrary = genericArbitrary uniform
instance (Arbitrary x, Arbitrary y) => Arbitrary (LargeKey x y) where
  arbitrary = LargeKey <$> arbitrary <*> arbitrary
instance Arbitrary Transaction where arbitrary = genericArbitrary uniform
instance Arbitrary x => Arbitrary (WithNext x) where
  arbitrary = genericArbitrary uniform
instance Arbitrary BlockData where arbitrary = genericArbitrary uniform
instance Arbitrary Block where arbitrary = genericArbitrary uniform
instance Arbitrary Account where arbitrary = genericArbitrary uniform
instance Arbitrary Difficulty where arbitrary = genericArbitrary uniform
instance Arbitrary TxCount where arbitrary = genericArbitrary uniform
instance Arbitrary Storage where arbitrary = genericArbitrary uniform
