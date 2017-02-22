{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS -fno-warn-unused-top-binds #-}
{-# OPTIONS -fno-warn-missing-signatures #-}

module Main (main) where

import           Control.Exception (bracket)
import           Data.Maybe
import           Data.Either
import           Data.Tree
import           Data.Ord
import           Data.List
import           Data.Foldable
import           Data.Traversable
import           Control.Monad
import           Control.Monad.IO.Class
import qualified Test.HUnit as HUnit
import           Database.Redis hiding (sortBy)
import           Test.Hspec
--import qualified Test.Hspec.Core.Spec as SpecM
import           Test.QuickCheck
import           Lens.Family2

import qualified Blockchain.Strato.RedisBlockDB as RDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.Transaction
import           Blockchain.Data.ArbitraryInstances()
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.Model.Class
import           Blockchain.Format
import           Blockchain.Strato.RedisBlockDB.Test.Chain

------------------------------------------------------------------------------
-- Main and helpers
--
main :: IO ()
main = hspec specTest

openConn :: Integer -> IO Connection
openConn num = do
    let connInfo = defaultConnectInfo{connectHost="localhost", connectDatabase = num}
    -- liftIO $ putStrLn $ "Opening connection to Redis database: " ++ show connInfo 
    connect connInfo

closeConn :: Connection -> IO ()
closeConn _ = do
--    liftIO $ putStrLn $ "Closing connection to Redis"
    return () 

withConn :: Integer -> (Connection -> IO ()) -> IO ()
withConn num = bracket (openConn num) closeConn

-- flushGroup :: Integer -> String -> SpecM.SpecM Connection () -> Spec
-- flushGroup dbNum name tests = around (withConn dbNum) . describe name $ do
--     beforeAll $ \conn -> runRedis conn flushdb
--     tests

flushDB :: SpecWith Connection 
flushDB = it "Should flush the db" $ \conn -> do
              res <- runRedis conn flushdb
              HUnit.assertBool "Couldn't flush the db" (isRight res)

-----------------------------------------------------------------------------
-- Tests
--
specTest :: Spec
specTest = around (withConn 1) $ do
    describe "BlockData" $ do

        flushDB

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

    describe "ChainTest" $ do
        
        flushDB

        it "Should get back best block after putting it" $ \conn -> do
            g <- liftIO $ makeGenesisBlock
            chain <- liftIO $ buildChain g 10 2
            let bb = last chain
            -- liftIO $ showChain chain
            r <- runRedis conn $ do
                void $ RDB.forceBestBlockInfo (blockHeaderHash bb) (blockDataNumber bb) 9999
                RDB.getBestBlockInfo :: Redis (Maybe (SHA, Integer, Integer))
            HUnit.assertEqual
                "Couldn't get back best block"
                (Just (blockHeaderHash bb, blockDataNumber bb, 9999)) r

    describe "ReplaceBestBlock" $ do
        
        flushDB
        void $ putTreeTest "Should generate a tree (force)" (workChain RDB.forceBestBlockInfo)
        -- 
        -- flushDB
        -- void $ putTreeTest "Should generate a tree (force)" (workChain RDB.forceBestBlockInfo)


        -- flushDB
        -- it "should ping" $ \conn -> do
        --     r <- runRedis conn (ping)
        --     HUnit.assertBool
        --         "ping"
        --         (isRight r) 

        flushDB
        void $ putTreeTest "Should generate a tree (put)" (workChain' RDB.putBestBlockInfo)
        
        -- flushDB
        -- it "Should fetch the canonical chain" $ \conn -> do
        --     g <- liftIO $ makeGenesisBlock
        --     tree <- bush g 6 3 :: IO (Tree BlockData)
        --     let bestBlocks = sortBy (comparing blockDataNumber) (leaves tree)
        --     let chains = flip stem' (toList tree) <$> bestBlocks

        --     liftIO . putStrLn $ showTree $ pb <$> tree
        --     r <- runRedis conn $ do
        --         void $ RDB.forceBestBlockInfo (blockHeaderHash g) (blockDataNumber g) 0
        --         workChain RDB.putBestBlockInfo $ head chains -- insert shortest best chain
        --         workChain RDB.putBestBlockInfo $ last chains -- insert longest best chain
        --         g' <- RDB.getCanonical 0
        --         liftIO . putStrLn $ show g'
        --         RDB.getCanonicalHeaderChain 0 (fromIntegral . blockDataNumber . last . last $ chains) :: Redis [(SHA, BlockData)]
        --     
        --     HUnit.assertEqual
        --         "Couldn't get the longest best chain"
        --         (pb <$> last chains) (pb <$> map snd r) 

putTreeTest :: String -> ([BlockData] -> Redis ()) -> SpecWith Connection 
putTreeTest msg putter = it msg $ \conn -> do
            g <- liftIO $ makeGenesisBlock
            tree <- bush g 6 3 :: IO (Tree BlockData)
            let bestBlocks = sortBy (comparing blockDataNumber) (leaves tree)
            let allblocks = toList $ tree
            let chains = flip stem' allblocks <$> bestBlocks

            liftIO . putStrLn . showTree $ pb <$> tree
            liftIO . putStrLn . show     $ pb <$> allblocks

            r <- runRedis conn $ do
                void $ RDB.forceBestBlockInfo (blockHeaderHash g) (blockDataNumber g) 0
                forM_ allblocks RDB.putHeader
                forM chains $ \chain -> do
                    liftIO . putStrLn . show $ pb <$> chain
                    putter $ chain
                    RDB.getBestBlockInfo :: Redis (Maybe (SHA, Integer, Integer))

            let lengths = fromIntegral . length <$> chains
            let mix = zip3 r lengths bestBlocks 
            results <- forM mix $ \(b, l, a) -> do
                let ls = Just (blockHeaderHash a, blockDataNumber a, l)
                return $ ls == b

            HUnit.assertBool
                "Couldn't get best block iterated from chain"
                (and results)

workChain :: (SHA -> Integer -> Integer -> Redis (Either Reply Status)) -> [BlockData] -> Redis ()
workChain g chain = forM_ zC f
    where
        f (b, i) = g (blockHeaderHash b) (blockDataNumber b) i
        zC       = zip (reverse chain) [1..]

workChain' :: (SHA -> Integer -> Integer -> Redis (Either Reply Status)) -> [BlockData] -> Redis () 
workChain' g chain = foldM_ f 0 chain
    where
        f d b = do
            void $ g (blockHeaderHash b) (blockDataNumber b) d
            pure $ d + (blockDataDifficulty b)

pb :: BlockData -> (Integer, Integer, String, String) 
pb x = ( blockDataNumber x
       , blockDataDifficulty x
       , "h:" ++ (showHash . blockHeaderHash $ x)
       , "p:" ++ (showHash . blockDataParentHash $ x)
       )
