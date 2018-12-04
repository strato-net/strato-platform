import Criterion.Main

import Data.Bits ((.&.))
import Data.Word
import qualified Data.Vector as V
import qualified Data.Set as S
import qualified Data.HashSet as H

import Network.Haskoin.Crypto.BigWord (Word256(..))
import Blockchain.VM.VMState

-- Simulate an out of bounds destination, to see how behavior scales
exampleDest :: Word256
exampleDest = 200000

list256Dests :: Int -> [Word256]
list256Dests n = map fromIntegral [1..n]

vec256Dests :: Int -> V.Vector Word256
vec256Dests = V.fromList . list256Dests

set256Dests :: Int -> S.Set Word256
set256Dests = S.fromList . list256Dests

hash256Dests :: Int -> H.HashSet Word256
hash256Dests = H.fromList . list256Dests

list256MembershipTests :: Int -> Benchmark
list256MembershipTests n = bench ("list word256 " ++ show n)
                         $ nf (elem exampleDest) (list256Dests n)

vec256MembershipTests :: Int -> Benchmark
vec256MembershipTests n = bench ("vec word256 " ++ show n)
                        $ nf (V.elem exampleDest) (vec256Dests n)

set256MembershipTests :: Int -> Benchmark
set256MembershipTests n = bench ("set word256 " ++ show n)
                        $ nf (S.member exampleDest) (set256Dests n)

hash256MembershipTests :: Int -> Benchmark
hash256MembershipTests n = bench ("set word256 " ++ show n)
                         $ nf (H.member exampleDest) (hash256Dests n)

list64Dests :: Int -> [Word64]
list64Dests n = map fromIntegral [1..n]

vec64Dests :: Int -> V.Vector Word64
vec64Dests = V.fromList . list64Dests

set64Dests :: Int -> S.Set Word64
set64Dests = S.fromList . list64Dests

hash64Dests :: Int -> H.HashSet Word64
hash64Dests = H.fromList . list64Dests

downgrade :: Word256 -> Word64
downgrade n = fromInteger (toInteger n .&. 0xffffffffffffffff)

list64MembershipTests :: Int -> Benchmark
list64MembershipTests n = bench ("list word64 " ++ show n)
                        $ nf (elem (downgrade exampleDest)) (list64Dests n)

vec64MembershipTests :: Int -> Benchmark
vec64MembershipTests n = bench ("vec word64 " ++ show n)
                       $ nf (V.elem (downgrade exampleDest)) (vec64Dests n)

set64MembershipTests :: Int -> Benchmark
set64MembershipTests n = bench ("set word64 " ++ show n)
                       $ nf (S.member (downgrade exampleDest)) (set64Dests n)

hash64MembershipTests :: Int -> Benchmark
hash64MembershipTests n = bench ("hash word64 " ++ show n)
                        $ nf (H.member (downgrade exampleDest)) (hash64Dests n)

main :: IO ()
main = do
  let jumpSizes = [1, 4, 16, 256]
  defaultMain $ map list256MembershipTests jumpSizes
             ++ map vec256MembershipTests jumpSizes
             ++ map set256MembershipTests jumpSizes
             ++ map hash256MembershipTests jumpSizes
