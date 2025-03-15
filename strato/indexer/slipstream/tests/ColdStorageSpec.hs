{-# LANGUAGE OverloadedStrings #-}

module ColdStorageSpec where

import BlockApps.Logging
import BlockApps.Solidity.Value
import Blockchain.Slipstream.GlobalsColdStorage
import Blockchain.Strato.Model.Account
import ClassyPrelude
import Control.Monad.Trans.Resource
import Database.Persist.Sqlite
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
      let address = 0xdeadbeef
          vals =
            [ ("owner", ValueContract $ unspecifiedChain 0x888),
              ("distance", SimpleValue $ valueUInt 23)
            ]

      h <- initStorage
      asyncWriteToStorage h address vals
      syncStorage h
      readStorage h address `shouldReturn` Right vals

    it "requires a matching address and chain" . runTest $ do
      let address = 99
      h <- initStorage
      asyncWriteToStorage h address []
      syncStorage h
      readStorage h address `shouldReturn` Right []
      readStorage h 98 `shouldReturn` Left "storage not found"

    it "can update contracts" . runTest $ do
      let address = 0x4
          vals n = [("Age", SimpleValue $ valueUInt n)]
      h <- initStorage
      forM_ [1 .. 97] $ asyncWriteToStorage h address . vals
      syncStorage h
      readStorage h address `shouldReturn` Right [("Age", SimpleValue $ valueUInt 97)]

    it "can handle large contracts" . runTest $ do
      let address = 99
          vals = [("field_" <> tshow n, SimpleValue $ valueUInt n) | n <- [0 .. 400000]]
      h <- initStorage
      asyncWriteToStorage h address vals
      syncStorage h
      readStorage h address `shouldReturn` Right vals

    it "can pretend to do work" $ do
      let h = fakeHandle
      asyncWriteToStorage h (error "address") (error "vals") `shouldReturn` ()
      readStorage h (error "address") `shouldReturn` Left "fake handle"
      syncStorage h `shouldReturn` () :: IO ()

    it "will avoid a DB read if the bloom filter catches the keys" . runTest $ do
      let address = 0x64
      h <- initStorage
      readStorage h address `shouldReturn` Left "storage not found"
