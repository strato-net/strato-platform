import Criterion.Main

import Data.Bits ((.&.))
import Data.Word
import qualified Data.Vector as V
import qualified Data.Set as S
import qualified Data.IntSet as I

import Network.Haskoin.Internals (Word256)

exampleDest :: Word256
exampleDest = 200000

list256Dests :: Int -> [Word256]
list256Dests n = map fromIntegral [1..n]

vec256Dests :: Int -> V.Vector Word256
vec256Dests = V.fromList . list256Dests

set256Dests :: Int -> S.Set Word256
set256Dests = S.fromList . list256Dests

list256MembershipTests :: Int -> Benchmark
list256MembershipTests n = bench ("list word256 " ++ show n)
                         $ nf (elem exampleDest) (list256Dests n)

vec256MembershipTests :: Int -> Benchmark
vec256MembershipTests n = bench ("vec word256 " ++ show n)
                        $ nf (V.elem exampleDest) (vec256Dests n)

set256MembershipTests :: Int -> Benchmark
set256MembershipTests n = bench ("set word256 " ++ show n)
                        $ nf (S.member exampleDest) (set256Dests n)

list64Dests :: Int -> [Word64]
list64Dests n = map fromIntegral [1..n]

vec64Dests :: Int -> V.Vector Word64
vec64Dests = V.fromList . list64Dests

set64Dests :: Int -> S.Set Word64
set64Dests = S.fromList . list64Dests

intsetDests :: Int -> I.IntSet
intsetDests n = I.fromList [0..n]

downgrade :: (Integral a) => Word256 -> a
downgrade n = fromInteger (toInteger n .&. 0xffffffffffffffff)

intsetMembershipTests :: Int -> Benchmark
intsetMembershipTests n = bench ("intset " ++ show n)
                        $ nf (I.member (downgrade exampleDest)) (intsetDests n)

list64MembershipTests :: Int -> Benchmark
list64MembershipTests n = bench ("list word64 " ++ show n)
                        $ nf (elem (downgrade exampleDest)) (list64Dests n)

vec64MembershipTests :: Int -> Benchmark
vec64MembershipTests n = bench ("vec word64 " ++ show n)
                       $ nf (V.elem (downgrade exampleDest)) (vec64Dests n)

set64MembershipTests :: Int -> Benchmark
set64MembershipTests n = bench ("set word64 " ++ show n)
                       $ nf (S.member (downgrade exampleDest)) (set64Dests n)

main :: IO ()
main = do
  let jumpSizes = [256, 4096, 32768]
  defaultMain $ map list256MembershipTests jumpSizes
             ++ map vec256MembershipTests jumpSizes
             ++ map set256MembershipTests jumpSizes
             ++ map list64MembershipTests jumpSizes
             ++ map vec64MembershipTests jumpSizes
             ++ map set64MembershipTests jumpSizes
             ++ map intsetMembershipTests jumpSizes
