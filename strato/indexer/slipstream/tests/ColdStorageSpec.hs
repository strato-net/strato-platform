{-# LANGUAGE OverloadedStrings #-}

module ColdStorageSpec where

import BlockApps.Logging
import BlockApps.Solidity.Value
import Blockchain.Strato.Model.Account
import ClassyPrelude
import Control.Monad.Trans.Resource
import Database.Persist.Sqlite
import Slipstream.GlobalsColdStorage
import Test.Hspec (Spec, describe, it)
import Test.Hspec.Expectations.Lifted
import qualified Prelude as P ()

runTest :: ReaderT SqlBackend (NoLoggingT (ResourceT IO)) () -> IO ()
runTest = runSqlite ":memory:"

spec :: Spec
spec = do
  describe "ColdStorage" $ do
    it "can initialize workers" . runTest $ do
      h1 <- initStorage
      syncStorage h1
      h2 <- initStorage
      syncStorage h2

    it "can read writes" . runTest $ do
      let acct = Account 0xdeadbeef (Just 87)
          vals =
            [ ("owner", ValueContract $ unspecifiedChain 0x888),
              ("distance", SimpleValue $ valueUInt 23)
            ]

      h <- initStorage
      asyncWriteToStorage h acct vals
      syncStorage h
      readStorage h acct `shouldReturn` Right vals

    it "requires a matching address and chain" . runTest $ do
      let acct = Account 99 Nothing
      h <- initStorage
      asyncWriteToStorage h acct []
      syncStorage h
      readStorage h acct `shouldReturn` Right []
      readStorage h (Account 98 Nothing) `shouldReturn` Left "storage not found"
      readStorage h (Account 99 (Just 17)) `shouldReturn` Left "storage not found"

    it "can update contracts" . runTest $ do
      let acct = Account 0x4 Nothing
          vals n = [("Age", SimpleValue $ valueUInt n)]
      h <- initStorage
      forM_ [1 .. 97] $ asyncWriteToStorage h acct . vals
      syncStorage h
      readStorage h acct `shouldReturn` Right [("Age", SimpleValue $ valueUInt 97)]

    it "can handle large contracts" . runTest $ do
      let acct = Account 99 Nothing
          vals = [("field_" <> tshow n, SimpleValue $ valueUInt n) | n <- [0 .. 400000]]
      h <- initStorage
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
      h <- initStorage
      readStorage h acct `shouldReturn` Left "storage not found"
