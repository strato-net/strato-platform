{-# LANGUAGE OverloadedStrings #-}
module ColdStorageSpec where

import ClassyPrelude
import Control.Monad.Logger
import Control.Monad.Trans.Resource
import Database.Persist.Sqlite
import qualified Prelude as P()
import Test.Hspec (Spec, describe, it)
import Test.Hspec.Expectations.Lifted

import BlockApps.Ethereum
import BlockApps.Solidity.Value
import Slipstream.GlobalsColdStorage

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
      let addr = Address 0xdeadbeef
          cid = Just $ ChainId 87
          vals = [ ("owner", ValueContract $ Address 0x888)
                 , ("distance", SimpleValue $ valueUInt 23)]

      h <- initStorage
      asyncWriteToStorage h addr cid vals
      syncStorage h
      readStorage h addr cid `shouldReturn` Right vals

    it "requires a matching address and chain" . runTest $ do
      let addr = Address 99
          cid = Nothing
      h <- initStorage
      asyncWriteToStorage h addr cid []
      syncStorage h
      readStorage h addr cid `shouldReturn` Right []
      readStorage h (Address 98) cid `shouldReturn` Left "storage not found"
      readStorage h addr (Just $ ChainId 17) `shouldReturn` Left "storage not found"

    it "can update contracts" . runTest $ do
      let addr = Address 0x4
          cid = Nothing
          vals n = [("Age", SimpleValue $ valueUInt n)]
      h <- initStorage
      forM_ [1..97] $ asyncWriteToStorage h addr cid . vals
      syncStorage h
      readStorage h addr cid `shouldReturn` Right [("Age", SimpleValue $ valueUInt 97)]

    it "can handle large contracts" . runTest $ do
      let addr = Address 99
          cid = Nothing
          vals = [("field_" <> tshow n, SimpleValue $ valueUInt n) | n <- [0..400000]]
      h <- initStorage
      asyncWriteToStorage h addr cid vals
      syncStorage h
      readStorage h addr cid `shouldReturn` Right vals

    it "can pretend to do work" $ do
      let h = fakeHandle
      asyncWriteToStorage h (error "addr") (error "cid") (error "vals") `shouldReturn` ()
      readStorage h (error "addr") (error "cid") `shouldReturn` Left "fake handle"
      syncStorage h `shouldReturn` () :: IO ()
