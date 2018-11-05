{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Strato.ClientSpec where

import           Data.Either
import           Generic.Random
import           Network.HTTP.Client
import           Servant.Client
import           Test.Hspec
import           Test.Hspec.QuickCheck
import           Test.QuickCheck

import           BlockApps.Strato.Client
import           BlockApps.Strato.Types

stratoDev :: BaseUrl
stratoDev = BaseUrl Http "localhost" 80 "/strato-api/eth/v1.2"

spec :: Spec
spec
  = modifyMaxSuccess (const 10)
  . beforeAll (newManager defaultManagerSettings) $ do
  describe "getTxsLast" $
    it "works" $ \ mgr -> do
      txs <- runClientM (getTxsLast 10 Nothing) (ClientEnv mgr stratoDev Nothing)
      txs `shouldSatisfy` isRight
  describe "getTxsFilter" $ do
    it "works with a nonempty filter" $ \ mgr -> do
      let nonEmptyParams = genericArbitrary uniform `suchThat` (/= txsFilterParams)
      forAll nonEmptyParams $ \ params -> do
          txs <- runClientM (getTxsFilter params) (ClientEnv mgr stratoDev Nothing)
          txs `shouldSatisfy` isRight
    it "doesn't work with an empty filter" $ \ mgr -> do
      txs <- runClientM
        (getTxsFilter txsFilterParams)
        (ClientEnv mgr stratoDev Nothing)
      txs `shouldSatisfy` isLeft
  describe "getBlocksLast" $
    it "works" $ \ mgr -> do
      txs <- runClientM (getBlocksLast 10 Nothing) (ClientEnv mgr stratoDev Nothing)
      txs `shouldSatisfy` isRight
  describe "getBlocksFilter" $ do
    it "works with a nonempty filter" $ \ mgr -> do
      let
        nonEmptyParams = genericArbitrary uniform `suchThat` (/= blocksFilterParams)
      forAll nonEmptyParams $ \ params -> do
          blocks <- runClientM
            (getBlocksFilter params)
            (ClientEnv mgr stratoDev Nothing)
          blocks `shouldSatisfy` isRight
    it "doesn't work with an empty filter" $ \ mgr -> do
      blocks <- runClientM
        (getBlocksFilter blocksFilterParams)
        (ClientEnv mgr stratoDev Nothing)
      blocks `shouldSatisfy` isLeft
  describe "getAccountsFilter" $ do
    it "works with a nonempty filter" $ \ mgr -> do
      let
        nonEmptyParams =
          genericArbitrary uniform `suchThat` (/= accountsFilterParams)
      forAll nonEmptyParams $ \ params -> do
          accts <- runClientM
            (getAccountsFilter params)
            (ClientEnv mgr stratoDev Nothing)
          accts `shouldSatisfy` isRight
    it "doesn't work with an empty filter" $ \ mgr -> do
      accts <- runClientM
        (getAccountsFilter accountsFilterParams)
        (ClientEnv mgr stratoDev Nothing)
      accts `shouldSatisfy` isLeft
  describe "getDifficulty" $
    it "works" $ \ mgr -> do
      diff <- runClientM getDifficulty (ClientEnv mgr stratoDev Nothing)
      diff `shouldSatisfy` isRight
  describe "getTotalTx" $
    it "works" $ \ mgr -> do
      diff <- runClientM getTotalTx (ClientEnv mgr stratoDev Nothing)
      diff `shouldSatisfy` isRight
  describe "getStorage" $
    it "works" $ \ mgr ->
      forAll (Just <$> arbitrary) $ \ addr -> do
        let p = storageFilterParams{qsAddress = addr}
        str <- runClientM (getStorage p) (ClientEnv mgr stratoDev Nothing)
        str `shouldSatisfy` isRight
  describe "postTx" $
    it "works" $ \ mgr ->
      forAll arbitrary $ \ tx -> do
        resp <- runClientM (postTx tx) (ClientEnv mgr stratoDev Nothing)
        resp `shouldSatisfy` isRight
  describe "postTxList" $
    it "works" $ \ mgr ->
      forAll arbitrary $ \ tx -> do
        resp <- runClientM (postTxList [tx,tx,tx]) (ClientEnv mgr stratoDev Nothing)
        resp `shouldSatisfy` isRight
  describe "postFaucet" $
    it "works" $ \ mgr ->
      forAll arbitrary $ \ addr -> do
        resp <- runClientM (postFaucet addr) (ClientEnv mgr stratoDev Nothing)
        resp `shouldSatisfy` isRight

-- orphans

instance Arbitrary TransactionType where arbitrary = genericArbitrary uniform
instance Arbitrary Transaction where arbitrary = genericArbitrary uniform
instance Arbitrary x => Arbitrary (WithNext x) where
  arbitrary = genericArbitrary uniform
instance Arbitrary BlockData where arbitrary = genericArbitrary uniform
instance Arbitrary Block where arbitrary = genericArbitrary uniform
instance Arbitrary Account where arbitrary = genericArbitrary uniform
instance Arbitrary Difficulty where arbitrary = genericArbitrary uniform
instance Arbitrary TxCount where arbitrary = genericArbitrary uniform
instance Arbitrary Storage where arbitrary = genericArbitrary uniform
