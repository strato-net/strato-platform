{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS -fno-warn-unused-top-binds #-}
{-# OPTIONS -fno-warn-missing-signatures #-}

module Main (main) where

import           Control.Exception (bracket)
import           Data.Maybe
import           Control.Monad
import           Control.Monad.IO.Class
import qualified Test.HUnit as HUnit
import           Database.Redis
import           Test.Hspec
import           Test.QuickCheck
import           Lens.Family2

import qualified Blockchain.Strato.RedisBlockDB as RDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.Transaction
import           Blockchain.Data.ArbitraryInstances()
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.Model.Class
import           Blockchain.Format
import           TestChain

------------------------------------------------------------------------------
-- Main and helpers
--
main :: IO ()
main = hspec specTest

openConn :: IO Connection
openConn = connect defaultConnectInfo

closeConn :: Connection -> IO ()
closeConn _ = return () 

withConn :: (Connection -> IO ()) -> IO ()
withConn = bracket openConn closeConn 

-----------------------------------------------------------------------------
-- Tests
--
specTest :: Spec
specTest = around withConn $ describe "BlockData" $ do
    it "Should not have a header for SHA 0" $ \c -> do
        r <- runRedis c (RDB.getHeader $ SHA 0 :: Redis (Maybe BlockData))
        HUnit.assertBool "Found header for SHA 0" $ isNothing r

    it "Should not have a block for SHA 0" $ \c -> do
        r <- runRedis c (RDB.getBlock $ SHA 0 :: Redis (Maybe Block))
        HUnit.assertBool "Found block for SHA 0" $ isNothing r

    it "Should put and get a header" $ \c -> do
        b <- generate arbitrary :: IO BlockData
        let theHash = blockHeaderHash b
        r <- runRedis c $ do 
            void $ RDB.putHeader b
            b' <- RDB.getHeader theHash :: Redis (Maybe BlockData)
            return $ isJust b'
        HUnit.assertBool "Couldn't recover header after put" r

    it "Should put a BlockHeader with parent and get back the parent" $ \conn -> do
        p <- generate arbitrary :: IO BlockData
        let pHash = blockHeaderHash p
        c <- generate arbitrary :: IO BlockData
        let c' = over _blockDataParentHash (const $ blockHeaderHash p) c 
        let cHash = blockHeaderParentHash c'  
        p' <- runRedis conn $ do
            void $ RDB.putHeader p
            void $ RDB.putHeader c'
            RDB.getParent (blockHeaderHash c') :: Redis (Maybe SHA)
        HUnit.assertEqual
            ("Couldn' match parent hash for child " ++ format cHash ++ " and parent " ++ format pHash)
            (Just pHash) p'

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
        r <- runRedis c $ do
            void $ RDB.putBlock b
            ts <- RDB.getUncles theHash :: Redis (Maybe [BlockData])
            return $ case ts of
                Nothing -> -1
                Just tss -> length tss
        HUnit.assertEqual
            ("Couldn't recover uncles from block with hash: " ++ format theHash)
            uCount r

    it "Should put a block with parent and get back the parent" $ \conn -> do
        p <- generate arbitrary :: IO Block
        let pHash = blockHash p
        c <- generate arbitrary :: IO Block
        let c' = over (_blockBlockData . _blockDataParentHash) (const $ pHash) c
        let cHash = blockHash c'
        r <- runRedis conn $ do
            void $ RDB.putBlock p
            void $ RDB.putBlock c'
            cph <- RDB.getParent cHash :: Redis (Maybe SHA)
            case cph of
                Nothing -> pure Nothing 
                Just pp -> RDB.getBlock pp :: Redis (Maybe Block)
        HUnit.assertEqual
            ("Couldn't recover parent hash for child " ++ format cHash ++ " and parent " ++ format pHash)
            (Just pHash) (blockHash <$> r)

    it "Should get genesis from chain" $ \conn -> do
        g <- liftIO $ makeGenesisBlock
        let genHash = blockHeaderHash g
        chain <- liftIO $ buildChain g 2 2
        r <- runRedis conn $ do 
            void $ RDB.putHeaders chain
            RDB.getHeader genHash :: Redis (Maybe BlockData)
        HUnit.assertEqual
            "Couldn't find header for genesis block from chain generated from genesis block"
            (Just genHash) (blockHeaderHash <$> r)

--     it "Should get common ancestor for two chains" $ \conn -> do
--         let n = 10
--         g <- liftIO $ makeGenesisBlock
--         chain <- liftIO $ buildChain g n 2
--         r <- runRedis conn $ do
--             void $ RDB.putBestBlockInfo 


--     it "Should get a whole chain" $ \conn -> do
--         let n = 10
--         g <- liftIO $ makeGenesisBlock
--         chain <- liftIO $ buildChain g n 0
--         r <- runRedis conn $ do
--             void $ RDB.putCanonical chain
--             chainHashes <- RDB.getCanonicalChain 1 n :: Redis [SHA]
--             RDB.getHeaders chainHashes :: Redis [(SHA, Maybe BlockData)]
--         HUnit.assertEqual
--             "Couldn't fetch canonical chain"
--             (length r) n


