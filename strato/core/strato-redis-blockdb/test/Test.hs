{-# LANGUAGE RecordWildCards #-}

{-# OPTIONS -fno-warn-unused-top-binds #-}
{-# OPTIONS -fno-warn-missing-signatures #-}
{-# OPTIONS -fno-warn-deprecations #-}
module Main where

import Blockchain.Data.ArbitraryInstances ()
import Blockchain.Data.Block (Block (..))
import Blockchain.Data.BlockHeader
import Blockchain.Sequencer.Event
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.RedisBlockDB as RDB
import Blockchain.Strato.RedisBlockDB.Models
import Blockchain.Strato.RedisBlockDB.Test.Chain
import Control.Exception (bracket)
import Control.Monad
import Control.Monad.IO.Class
import Data.Either
import Data.Foldable
import Data.List
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
main = hspec specTest

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
specTest :: Spec
specTest = around (withConn 1) $ do
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

    it "Should put a block and get its uncles" $ \c -> do
      b <- generate arbitrary
      let theHash = blockHash b
      let uCount = length $ blockUncleHeaders b
      r <- runRedis c $ do
        void $ RDB.putBlock b
        ts <- RDB.getUncles theHash
        return $ case ts of
          Nothing -> -1
          Just tss -> length tss
      HUnit.assertEqual
        ("Couldn't recover uncles from block with hash: " ++ format theHash)
        uCount
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
            return $ bestBlockHash <$> res

        let bbs = flip map bestBlocks $ \bb -> Just $ (blockHeaderHash bb)
        HUnit.assertBool
          ("Couldn't get best block iterated from chain (" ++ (show . length $ tree) ++ ", " ++ (show . length . leaves $ tree) ++ ")")
          (bbs == r)

    forM_ [4 .. 10] $ \n -> forM_ [3 .. 5] $ \m -> do
      flushDB
      it "Should update canonical chainY after switching all branches" $ \conn -> do
        g <- liftIO makeGenesisBlock
        tree <- bushY g m n :: IO (Tree BlockHeader)
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
            return $ bestBlockHash <$> res

        let bbs = flip map bestBlocks $ \bb -> Just $ (blockHeaderHash bb)
        HUnit.assertBool
          ("Couldn't get best block iterated from chain (" ++ (show . length $ tree) ++ ", " ++ (show . length . leaves $ tree) ++ ")")
          (bbs == r)

    flushDB
    it "Should fetch the canonical chain" $ \conn -> do
      g <- liftIO makeGenesisBlock
      tree <- bush g 6 3 :: IO (Tree BlockHeader)
      let allblocks = toList tree
      let bestBlocks = sortBy (comparing number) (leaves tree)
      let chains = flip stem' (toList tree) <$> bestBlocks

      -- liftIO . putStrLn $ showTree $ pb <$> tree
      r <- runRedis conn $ do
        forM_ allblocks RDB.putHeader
        void $ RDB.forceBestBlockInfo (blockHeaderHash g) (number g)
        workChain RDB.putBestBlockInfo $ head chains -- insert shortest best chain
        workChain RDB.putBestBlockInfo $ last chains -- insert longest best chain
        let maxN = fromIntegral . number . head . last $ chains
        RDB.getCanonicalHeaderChain 0 maxN :: Redis [(Keccak256, BlockHeader)]

      HUnit.assertEqual
        "Couldn't get the longest best chain"
        ((reverse . drop 1) (pb <$> last chains))
        (pb <$> map snd r)

    forM_ [4 .. 10] $ \n -> forM_ [3 .. 5] $ \m -> do
      flushDB
      it "Should verify the canonical chain after switching all branches" $ \conn -> do
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
            return $ bestBlockHash <$> res

        let bbs = flip map bestBlocks $ \bb -> Just $ (blockHeaderHash bb)
        HUnit.assertBool
          ("Couldn't get best block iterated from chain (" ++ (show . length $ tree) ++ ", " ++ (show . length . leaves $ tree) ++ ")")
          (bbs == r)

        validated <- runRedis conn $ do
          let maxN = fromIntegral . number . head . last $ chains
          canon <- RDB.getCanonicalHeaderChain 0 maxN :: Redis [(Keccak256, BlockHeader)]
          return . validateChain . map snd $ canon

        HUnit.assertBool
          ("Couldn't validate the canonical chain")
          (validated)

    flushDB
    it "Should build a valid chain by calling extendChain" $ \conn -> do
      chain <- createChain 10
      validated <- runRedis conn $ do
        let maxN = fromIntegral . number . last $ chain
        canon <- RDB.getCanonicalHeaderChain 0 maxN :: Redis [(Keccak256, BlockHeader)]
        return . validateChain . map snd $ canon

      HUnit.assertBool
        ("Couldn't validate the canonical chain")
        (validated)

    flushDB
    it "Should fork a chain and update the canonical chain with the longer chain" $ \conn -> do
      g <- makeGenesisBlock
      chain <- extendChain 4 [g]
      oldChain <- extendChain 5 chain
      newChain <- extendChain 7 chain
      newCanon <- runRedis conn $ do
        forM_ oldChain RDB.putHeader
        void $ RDB.forceBestBlockInfo (blockHeaderHash g) (number g)
        workChain RDB.putBestBlockInfo oldChain
        forM_ newChain RDB.putHeader
        workChain RDB.putBestBlockInfo newChain
        let maxN = (+ 1) . fromIntegral . number . last $ newChain
        canon <- RDB.getCanonicalHeaderChain 0 maxN :: Redis [(Keccak256, BlockHeader)]
        return $ map snd canon

      HUnit.assertEqual
        ("Couldn't validate the canonical chain")
        newChain
        newCanon

    flushDB
    it "Should put blocks and create a canonical chain by proposing a best block" $ \conn -> do
      g <- makeGenesisBlock
      chain <- extendChain 10 [g]
      canon <- runRedis conn $ do
        void $ RDB.forceBestBlockInfo (blockHeaderHash g) (number g)
        forM_ chain $ RDB.putBlock . (\b -> morphBlock $ Block b [] [])
        _ <- putBestBlockInfo (last chain)
        let maxN = (+ 1) . fromIntegral . number . last $ chain
        canonical <- RDB.getCanonicalHeaderChain 0 maxN :: Redis [(Keccak256, BlockHeader)]
        return $ map snd canonical

      HUnit.assertBool ("Could not verify canonical chain") (validateChain canon)
      HUnit.assertEqual
        ("Canonical chain does not match original chain")
        chain
        canon

    flushDB
    it "Should fork a chain and call commonAncestorHelper with the new chain data" $ \conn -> do
      g <- makeGenesisBlock
      chain <- extendChain 4 [g]
      oldChain <- extendChain 5 chain
      newChain <- extendChain 7 chain
      void . runRedis conn $ do
        forM_ oldChain RDB.putHeader
        forM_ newChain RDB.putHeader
      eModsDels <- runRedis conn $ do
        forM_ newChain RDB.putHeader
        callCommonAncestor oldChain newChain
      HUnit.assertBool
        ("commonAncestorHelper returns list of modifications and deletions to the canonical chain")
        (isRight eModsDels)

    flushDB
    it "Should fork a chain and call commonAncestorHelper with the new chain data being the shorter chain" $ \conn -> do
      g <- makeGenesisBlock
      chain <- extendChain 4 [g]
      oldChain <- extendChain 7 chain
      newChain <- extendChain 5 chain
      void . runRedis conn $ do
        forM_ oldChain RDB.putHeader
        forM_ newChain RDB.putHeader
      eModsDels <- runRedis conn $ do
        forM_ newChain RDB.putHeader
        callCommonAncestor oldChain newChain
      HUnit.assertBool
        ("commonAncestorHelper returns list of modifications and deletions to the canonical chain")
        (isRight eModsDels)

  describe "commonAncestorHelper unit tests" $ do
    flushDB
    it "Should propose a new block with the same parent as best block" $ \conn -> do
      g <- makeGenesisBlock
      baseChain <- extendChain 1 [g]
      oldChain <- extendChain 1 baseChain
      newChain <- extendChain 2 baseChain
      canon <- runRedis conn $ insertAndUpdateChain g oldChain newChain
      HUnit.assertBool "Got an invalid chain from Redis" (validateChain $ map snd canon)

    flushDB
    it "Should propose a new block with the same grandparent as best block" $ \conn -> do
      g <- makeGenesisBlock
      baseChain <- extendChain 1 [g]
      oldChain <- extendChain 2 baseChain
      newChain <- extendChain 3 baseChain
      canon <- runRedis conn $ insertAndUpdateChain g oldChain newChain
      HUnit.assertBool "Got an invalid chain from Redis" (validateChain $ map snd canon)

    flushDB
    it "Should propose a new block when new chain is shorter than old chain" $ \conn -> do
      g <- makeGenesisBlock
      baseChain <- extendChain 1 [g]
      oldChain <- extendChain 3 baseChain
      newChain <- extendChain 2 baseChain
      canon <- runRedis conn $ insertAndUpdateChain g oldChain newChain
      HUnit.assertBool "Got an invalid chain from Redis" (validateChain $ map snd canon)

    flushDB
    it "Should fork a chain with same length and successfully update the canonical chain" $ \conn -> do
      g <- makeGenesisBlock
      chain <- extendChain 4 [g]
      oldChain <- extendChain 2 chain
      void . runRedis conn $ do
        forM_ oldChain RDB.putHeader
        void $ RDB.forceBestBlockInfo (blockHeaderHash g) (number g)
        forM oldChain putBestBlockInfo
      newChain <- extendChain 2 chain
      newCanon <- runRedis conn $ do
        forM_ newChain RDB.putHeader
        _ <- putBestBlockInfo (last newChain)
        let maxN = (+ 1) . fromIntegral . number . last $ newChain
        canon <- RDB.getCanonicalHeaderChain 0 maxN :: Redis [(Keccak256, BlockHeader)]
        return (map snd canon)
      HUnit.assertEqual
        ("Modifications and deletions share common entries")
        newChain
        newCanon

putBestBlockInfo :: BlockHeader -> Redis (Either Reply Status)
putBestBlockInfo b =
  let sha = blockHeaderHash b
      num = number b
   in RDB.putBestBlockInfo sha num

prettyBlock :: Monad m => BlockHeader -> m (Integer, String, String)
prettyBlock b = return (number b, showHash . parentHash $ b, showHash . blockHeaderHash $ b)

callCommonAncestor :: [BlockHeader] -> [BlockHeader] -> Redis (Either Reply ([(Keccak256, Integer)], [Integer])) -- ([Updates], [Deletions])
callCommonAncestor old new =
  let oldNumber = (fromIntegral . number . last) old
      newNumber = (fromIntegral . number . last) new
      oldSha = (blockHeaderHash . last) old
      newSha = (blockHeaderHash . last) new
   in RDB.commonAncestorHelper oldNumber newNumber oldSha newSha

insertAndUpdateChain :: BlockHeader -> [BlockHeader] -> [BlockHeader] -> Redis [(Keccak256, BlockHeader)]
insertAndUpdateChain g oldChain newChain = do
  void $ RDB.forceBestBlockInfo (blockHeaderHash g) (number g)
  forM_ oldChain $ RDB.putBlock . (\b -> morphBlock $ Block b [] [])
  forM_ newChain $ RDB.putBlock . (\b -> morphBlock $ Block b [] [])
  forM_ oldChain $ \b -> set (RDB.inNamespace Canonical $ number b) (toValue $ blockHeaderHash b)
  value <- callCommonAncestor oldChain newChain
  let (mods, dels) = either (error "wrong format in call to callCommonAncestor") id value
  _ <- callCommonAncestor oldChain newChain
  forM_ mods $ \(sha, num) -> set (RDB.inNamespace Canonical $ num) (toValue sha)
  unless (null dels) . void . del $ RDB.inNamespace Canonical . toKey <$> dels
  let maxN = (+ 1) . fromIntegral . number . last $ newChain
  RDB.getCanonicalHeaderChain 0 maxN :: Redis [(Keccak256, BlockHeader)]

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
