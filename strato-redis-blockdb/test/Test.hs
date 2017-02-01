module Main (main) where

import           Control.Exception (bracket)
import           Data.Maybe
import           Control.Monad
import           Control.Monad.IO.Class
import qualified Test.HUnit as HUnit
import           Database.Redis
import           Test.Hspec
import           Test.QuickCheck

import qualified Blockchain.Strato.RedisBlockDB as RDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.Transaction
import           Blockchain.Data.ArbitraryInstances()
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.Model.Class
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

    it "Should put a block and get its transactions" $ \c -> do
        b <- generate arbitrary :: IO Block 
        let theHash = blockHash b
        let txCount = length $ blockTransactions b
        r <- runRedis c $ do
            void $ RDB.putBlock b
            ts <- RDB.getTransactions theHash :: Redis (Maybe [Transaction])
            return $ case ts of
                Nothing -> -1
                Just tss -> length tss
        HUnit.assertEqual
            ("Couldn't recover tranasctions from block with hash: " ++ format theHash) 
            txCount r

    it "Should put a block and get its uncles" $ \c -> do
        b <- generate arbitrary :: IO Block 
        let theHash = blockHash b
        let uCount = length $ blockUncleHeaders b
        liftIO $ putStrLn $ "Uncles put: " ++ show uCount
        r <- runRedis c $ do
            void $ RDB.putBlock b
            ts <- RDB.getUncles theHash :: Redis (Maybe [BlockData])
            return $ case ts of
                Nothing -> -1
                Just tss -> length tss
        liftIO $ putStrLn $ "Uncles got: " ++ show r 
        HUnit.assertEqual
            ("Couldn't recover uncles from block with hash: " ++ format theHash)
            uCount r

--     it "Should put a block with parent and get back the parent" $ \c -> do
--         b <- generate arbitrary :: IO Block 
--         let theHash = blockHash b
--         r <- runRedis c $ do
--             void $ RDB.putBlock b
--             p  <- RDB.getParent theHash :: Redis (Maybe SHA)
--             pb <- RDB.getBlock p :: Redis (Maybe BlockData)
--             return $ case ts of
--                 Nothing -> SHA 0
--                 Just pp -> blockHash pp
--         liftIO $ putStrLn $ "Uncles got: " ++ show r 
--         HUnit.assertEqual
--             ("Couldn't recover parent from block with hash: " ++ format theHash)
--             (SHA 1) r


