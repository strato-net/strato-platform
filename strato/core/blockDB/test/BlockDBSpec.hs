{-# LANGUAGE RecordWildCards #-}

{-# OPTIONS -fno-warn-unused-top-binds #-}
{-# OPTIONS -fno-warn-missing-signatures #-}
{-# OPTIONS -fno-warn-deprecations #-}
module BlockDBSpec (spec) where

import qualified Blockchain.BlockDB as RDB
import qualified Blockchain.SyncDB as RDB
import Blockchain.Data.BlockHeader
import Blockchain.Model.SyncState
import Blockchain.Model.WrappedBlock
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.RedisBlockDB.Test.Chain
import Control.Exception (bracket)
import Control.Monad
import Control.Monad.IO.Class
import Data.Either
import Data.Foldable
import Data.List (sortBy)
import Data.Maybe
import Data.Ord
import Data.Tree
import Database.Redis hiding (sortBy)
import qualified Test.HUnit as HUnit
import Test.Hspec
import Test.QuickCheck
import Text.Format

------------------------------------------------------------------------------
-- Main and helpers
--
main :: IO ()
main = hspec spec

openConn :: Integer -> IO Connection
openConn num = do
  let connInfo = defaultConnectInfo {connectHost = "localhost", connectDatabase = num, connectPort = PortNumber 2023}
  -- liftIO $ putStrLn $ "Opening connection to Redis database: " ++ show connInfo
  connect connInfo

closeConn :: Connection -> IO ()
closeConn _ = return ()

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
spec :: Spec
spec = around (withConn 1) $ do
  describe "BlockData" $ do
    flushDB

    it "Should not have a header for Keccak256 0" $ \c -> do
      r <- runRedis c (RDB.getHeader $ unsafeCreateKeccak256FromWord256 0)
      HUnit.assertBool "Found header for Keccak256 0" $ isNothing r

    it "Should not have a block for Keccak256 0" $ \c -> do
      r <- runRedis c (RDB.getBlock $ unsafeCreateKeccak256FromWord256 0)
      HUnit.assertBool "Found block for Keccak256 0" $ isNothing r

    it "Should put and get a header" $ \c -> do
      b <- generate arbitrary
      let theHash = blockHeaderHash b
      r <- runRedis c $ do
        void $ RDB.putHeader b
        b' <- RDB.getHeader theHash
        return $ isJust b'
      HUnit.assertBool "Couldn't recover header after put" r

    it "Should put a BlockHeader with parent and get back the parent" $ \conn -> do
      p <- generate arbitrary
      let pHash = blockHeaderHash p
      c <- generate arbitrary
      let c' = c{parentHash=blockHeaderHash p}
      let cHash = blockHeaderParentHash c'
      p' <- runRedis conn $ do
        void $ RDB.putHeader p
        void $ RDB.putHeader c'
        RDB.getParent (blockHeaderHash c') :: Redis (Maybe Keccak256)
      HUnit.assertEqual
        ("Couldn' match parent hash for child " ++ format cHash ++ " and parent " ++ format pHash)
        (Just pHash)
        p'

    it "Should put and get a block" $ \c -> do
      b <- generate arbitrary
      let theHash = blockHash b
      r <- runRedis c $ do
        void $ RDB.putBlock b
        b' <- RDB.getBlock theHash
        return $ isJust b'
      HUnit.assertBool ("Couldn't recover block after put for hash: " ++ format theHash) r

    it "Should put a block and get its transactions" $ \c -> do
      b <- generate arbitrary
      let theHash = blockHash b
      let txCount = length $ blockTransactions b
      r <- runRedis c $ do
        void $ RDB.putBlock b
        ts <- RDB.getTransactions theHash
        return $ case ts of
          Nothing -> -1
          Just tss -> length tss
      HUnit.assertEqual
        ("Couldn't recover tranasctions from block with hash: " ++ format theHash)
        txCount
        r

    it "Should put a block with parent and get back the parent" $ \conn -> do
      p <- generate arbitrary
      let pHash = blockHash p
      c@OutputBlock {..} <- generate arbitrary
      let c' = c {obBlockData = obBlockData {parentHash = pHash}}
      let cHash = blockHash c'
      r <- runRedis conn $ do
        void $ RDB.putBlock p
        void $ RDB.putBlock c'
        cph <- RDB.getParent cHash :: Redis (Maybe Keccak256)
        case cph of
          Nothing -> pure Nothing
          Just pp -> RDB.getBlock pp
      HUnit.assertEqual
        ("Couldn't recover parent hash for child " ++ format cHash ++ " and parent " ++ format pHash)
        (Just pHash)
        (blockHash <$> r)
 
    it "Should get genesis from chain" $ \conn -> do
      g <- liftIO $ makeGenesisBlock
      let genHash = blockHeaderHash g
      chain <- liftIO $ buildChain g 2 2
      r <- runRedis conn $ do
        void $ RDB.putHeaders chain
        RDB.getHeader genHash
      HUnit.assertEqual
        "Couldn't find header for genesis block from chain generated from genesis block"
        (Just genHash)
        (blockHeaderHash <$> r)

  describe "ChainTest" $ do
    flushDB
    it "Should get back best block after putting it" $ \conn -> do
      g <- liftIO $ makeGenesisBlock
      chain <- liftIO $ buildChain g 10 2
      let bb = last chain
          bbh = blockHeaderHash bb
          bbn = number bb
      r <- runRedis conn $ do
        void $ RDB.forceBestBlockInfo bbh bbn
        RDB.getBestBlockInfo :: Redis (Maybe RedisBestBlock)
      HUnit.assertEqual
        "Couldn't get back best block"
        (Just (RedisBestBlock bbh bbn))
        r

  describe "ReplaceBestBlock" $ do
    forM_ [4 .. 10] $ \n -> forM_ [3 .. 5] $ \m -> do
      flushDB
      it "Should update canonical chain after switching all branches" $ \conn -> do
        g <- liftIO makeGenesisBlock
        tree <- bush g m n :: IO (Tree BlockHeader)
        let bestBlocks = sortBy (comparing number) (leaves tree)
        let allblocks = toList $ tree
        let chains = flip stem' allblocks <$> bestBlocks
        -- liftIO . putStrLn . showTree $ pb <$> tree

        r <- runRedis conn $ do
          void $ RDB.forceBestBlockInfo (blockHeaderHash g) (number g)
          forM_ allblocks RDB.putHeader
          forM chains $ \chain -> do
            workChain' RDB.putBestBlockInfo $ (reverse $ chain)
            res <- RDB.getBestBlockInfo :: Redis (Maybe RedisBestBlock)
            return $ redisBestBlockHash <$> res

        let bbs = flip map bestBlocks $ \bb -> Just $ (blockHeaderHash bb)
        HUnit.assertBool
          ("Couldn't get best block iterated from chain (" ++ (show . length $ tree) ++ ", " ++ (show . length . leaves $ tree) ++ ")")
          (bbs == r)

putBestBlockInfo :: BlockHeader -> Redis (Either Reply Status)
putBestBlockInfo b =
  let sha = blockHeaderHash b
      num = number b
   in RDB.putBestBlockInfo sha num

prettyBlock :: Monad m => BlockHeader -> m (Integer, String, String)
prettyBlock b = return (number b, showHash . parentHash $ b, showHash . blockHeaderHash $ b)

callCommonAncestor :: [BlockHeader] -> [BlockHeader] -> Redis (Either Reply ([(Keccak256, Integer)], [Integer])) -- ([Updates], [Deletions])
callCommonAncestor old new =
  let oldNumber = (number . last) old
      newNumber = (number . last) new
      oldSha = (blockHeaderHash . last) old
      newSha = (blockHeaderHash . last) new
   in RDB.commonAncestorHelper oldNumber newNumber oldSha newSha

workChain :: (Keccak256 -> Integer -> Redis (Either Reply Status)) -> [BlockHeader] -> Redis ()
workChain g chain = forM_ (reverse chain) f
  where
    f b = g (blockHeaderHash b) (number b)

workChain' :: (Keccak256 -> Integer -> Redis (Either Reply Status)) -> [BlockHeader] -> Redis ()
workChain' g = flip forM_ f
  where
    f b = do
      void $ g (blockHeaderHash b) (number b)

pb :: BlockHeader -> (Integer, Integer, String, String)
pb x =
  ( number x,
    difficulty x,
    "h:" ++ (showHash . blockHeaderHash $ x),
    "p:" ++ (showHash . parentHash $ x)
  )
