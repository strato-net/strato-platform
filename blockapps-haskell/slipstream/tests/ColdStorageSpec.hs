{-# LANGUAGE OverloadedStrings #-}
module ColdStorageSpec where

import ClassyPrelude
import Control.Monad.Trans.Resource
import Database.Persist.Sqlite
import qualified Prelude as P()
import Test.Hspec (Spec, describe, it)
import Test.Hspec.Expectations.Lifted

import BlockApps.Logging
import BlockApps.Solidity.Value
import Blockchain.Strato.Model.Account
import Slipstream.GlobalsColdStorage

runTest :: ReaderT SqlBackend (NoLoggingT (ResourceT IO)) () -> IO ()
runTest = runSqlite ":memory:"

spec :: Spec
spec = do
  describe "ColdStorage" $ do
    it "can initialize workers" . runTest $ do
      (ourFilt, h1) <- initStorage 0
      ourFilt `shouldSatisfy` id
      syncStorage h1
      (theirFilt, h2) <- initStorage 0
      theirFilt `shouldSatisfy` not
      syncStorage h2

    it "can read writes" . runTest $ do
      let acct = Account 0xdeadbeef (Just 87)
          vals = [ ("owner", ValueContract $ unspecifiedChain 0x888)
                 , ("distance", SimpleValue $ valueUInt 23)]

      (_, h) <- initStorage 0
      asyncWriteToStorage h acct vals
      syncStorage h
      readStorage h acct `shouldReturn` Right vals

    it "requires a matching address and chain" . runTest $ do
      let acct = Account 99 Nothing
      (_, h) <- initStorage 0
      asyncWriteToStorage h acct []
      syncStorage h
      readStorage h acct `shouldReturn` Right []
      readStorage h (Account 98 Nothing) `shouldReturn` Left "unseen by bloom filter"
      readStorage h (Account 99 (Just 17)) `shouldReturn` Left "unseen by bloom filter"

    it "can update contracts" . runTest $ do
      let acct = Account 0x4 Nothing
          vals n = [("Age", SimpleValue $ valueUInt n)]
      (_, h) <- initStorage 0
      forM_ [1..97] $ asyncWriteToStorage h acct . vals
      syncStorage h
      readStorage h acct `shouldReturn` Right [("Age", SimpleValue $ valueUInt 97)]

    it "can handle large contracts" . runTest $ do
      let acct = Account 99 Nothing
          vals = [("field_" <> tshow n, SimpleValue $ valueUInt n) | n <- [0..400000]]
      (_, h) <- initStorage 0
      asyncWriteToStorage h acct vals
      syncStorage h
      readStorage h acct `shouldReturn` Right vals

    it "can pretend to do work" $ do
      let h = fakeHandle
      asyncWriteToStorage h (error "acct") (error "vals") `shouldReturn` ()
      readStorage h (error "acct") `shouldReturn` Left "fake handle"
      syncStorage h `shouldReturn` () :: IO ()

    it "will avoid a DB read if the bloom filter catches the keys" . runTest $ do
      let acct = Account 0x64 Nothing
      (_, h) <- initStorage 0
      readStorage h acct `shouldReturn` Left "unseen by bloom filter"
