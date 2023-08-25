{-# LANGUAGE TupleSections #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# OPTIONS_GHC -fno-warn-unused-imports #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}

import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MPI
import Blockchain.Strato.Model.ExtendedWord (word256ToBytes)
import Control.DeepSeq
import Control.Monad
import Criterion.Main
import qualified Data.ByteString as B
import qualified Data.NibbleString as N
import Data.Word
import qualified Database.LevelDB as DB
import qualified Database.LevelDB.Base as DBB
import System.Directory
import System.Posix.Temp
import Test.QuickCheck
import Text.Printf

defaultKey :: N.NibbleString
defaultKey = N.EvenNibbleString $ B.replicate 32 0x0

defaultRLP :: RLPObject
defaultRLP = RLPScalar 0x45

instance Arbitrary N.NibbleString where
  arbitrary = (N.EvenNibbleString . word256ToBytes) <$> arbitrary

nenv :: Int -> IO (FilePath, MP.MPDB)
nenv n = do
  tmpdir <- mkdtemp "/tmp/mp_bench"
  db <- DBB.open (tmpdir ++ "/test.ldb") DB.defaultOptions {DB.createIfMissing = True}
  let mp = MP.MPDB {MP.ldb = db, MP.stateRoot = MP.blankStateRoot}
  MP.initializeBlank mp
  kvs <- makeRandomKeys n
  mp' <- foldM (\m (k, v) -> MP.putKeyVal m k v) mp kvs
  return (tmpdir, mp')

makeRandomKeys :: Int -> IO [(MP.Key, MP.Val)]
makeRandomKeys = fmap (fmap (,defaultRLP)) . generate . vector

benchMP :: NFData a => IO (FilePath, MP.MPDB) -> String -> (MP.MPDB -> IO a) -> Benchmark
benchMP mkenv name a =
  envWithCleanup
    mkenv
    (\ ~(p, _) -> removePathForcibly p)
    (\ ~(_, mp) -> bench name . nfIO $ a mp)

getBench :: Int -> Benchmark
getBench n = benchMP (nenv n) (printf "getKeyVal - %d" n) $
  \mp -> MP.getKeyVal mp defaultKey

putBench :: Int -> Benchmark
putBench n = benchMP (nenv n) (printf "putKeyVal - %d" n) $
  \mp -> MP.putKeyVal mp defaultKey defaultRLP

deleteBench :: Int -> Benchmark
deleteBench n = benchMP (nenv n) (printf "deleteKey - %d" n) $
  \mp -> MP.deleteKey mp defaultKey

existsBench :: Int -> Benchmark
existsBench n = benchMP (nenv n) (printf "keyExists - %d" n) $
  \mp -> MP.keyExists mp defaultKey

main :: IO ()
main =
  defaultMain
    [ getBench 0,
      getBench 10000,
      getBench 100000,
      putBench 0,
      putBench 10000,
      putBench 100000,
      deleteBench 0,
      deleteBench 10000,
      deleteBench 100000,
      existsBench 0,
      existsBench 10000,
      existsBench 100000
    ]
