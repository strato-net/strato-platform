module Main (main) where

import           Control.Exception (bracket)
import           Data.Maybe
import           Control.Monad
import qualified Test.HUnit as HUnit
import           Database.Redis
import           Test.Hspec
import           Test.QuickCheck

import qualified Blockchain.Strato.RedisBlockDB as RDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.ArbitraryInstances()
import           Blockchain.Strato.Model.SHA
import           Blockchain.Format

------------------------------------------------------------------------------
-- Main and helpers
--
main :: IO ()
main = hspec specTest

------------------------------------------------------------------------------
-- Tests
--

openConn :: IO Connection
openConn = connect defaultConnectInfo

closeConn :: Connection -> IO ()
closeConn _ = return () 

withConn :: (Connection -> IO ()) -> IO ()
withConn = bracket openConn closeConn 

specTest :: Spec
specTest = around withConn $ describe "BlockData" $ do
    it "Should not have a header for SHA 0" $ \c -> do
        r <- runRedis c $ do
            h <- RDB.getHeader $ SHA 0 :: Redis (Maybe BlockData)
            return $ isNothing h
        HUnit.assertBool "Found header for SHA 0" r

    it "Should not have a block for SHA 0" $ \c -> do
        r <- runRedis c $ do
            b <- RDB.getBlock $ SHA 0 :: Redis (Maybe Block) 
            return $ isNothing b
        HUnit.assertBool "Found block for SHA 0" r

    it "Should put and get a header" $ \c -> do
        b <- generate arbitrary :: IO BlockData
        let theHash = blockHeaderHash b
        r <- runRedis c $ do 
            void $ RDB.putHeader b
            b' <- RDB.getHeader theHash :: Redis (Maybe BlockData)
            return $ isJust b'
        HUnit.assertBool "Couldn't recover header after put" r

    it "Should put and get a block" $ \c -> do
        b <- generate arbitrary :: IO Block
        let theHash = blockHash b
        r <- runRedis c $ do 
            void $ RDB.putBlock b
            b' <- RDB.getBlock theHash :: Redis (Maybe Block)
            return $ isJust b'
        HUnit.assertBool ("Couldn't recover block after put for hash: " ++ format theHash) r
