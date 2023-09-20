{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}

import Blockchain.EVM.Code
import qualified Blockchain.EVM.MutableStack as MS
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord
import Control.DeepSeq
import Control.Monad
import Criterion.Main
import Data.Bits ((.&.))
import qualified Data.ByteString as B
import qualified Data.IntSet as I
import qualified Data.Set as S
import qualified Data.Vector as V
import GHC.Generics

-- JumpDest benchmarks
exampleDest :: Word256
exampleDest = 200000

list256Dests :: Int -> [Word256]
list256Dests n = map fromIntegral [1 .. n]

vec256Dests :: Int -> V.Vector Word256
vec256Dests = V.fromList . list256Dests

set256Dests :: Int -> S.Set Word256
set256Dests = S.fromList . list256Dests

list256MembershipTests :: Int -> Benchmark
list256MembershipTests n =
  bench ("list word256 " ++ show n) $
    nf (elem exampleDest) (list256Dests n)

vec256MembershipTests :: Int -> Benchmark
vec256MembershipTests n =
  bench ("vec word256 " ++ show n) $
    nf (V.elem exampleDest) (vec256Dests n)

set256MembershipTests :: Int -> Benchmark
set256MembershipTests n =
  bench ("set word256 " ++ show n) $
    nf (S.member exampleDest) (set256Dests n)

list64Dests :: Int -> [Word64]
list64Dests n = map fromIntegral [1 .. n]

vec64Dests :: Int -> V.Vector Word64
vec64Dests = V.fromList . list64Dests

set64Dests :: Int -> S.Set Word64
set64Dests = S.fromList . list64Dests

intsetDests :: Int -> I.IntSet
intsetDests n = I.fromList [0 .. n]

downgrade :: (Integral a) => Word256 -> a
downgrade n = fromInteger (toInteger n .&. 0xffffffffffffffff)

intsetMembershipTests :: Int -> Benchmark
intsetMembershipTests n =
  bench ("intset " ++ show n) $
    nf (I.member (downgrade exampleDest)) (intsetDests n)

list64MembershipTests :: Int -> Benchmark
list64MembershipTests n =
  bench ("list word64 " ++ show n) $
    nf (elem (downgrade exampleDest)) (list64Dests n)

vec64MembershipTests :: Int -> Benchmark
vec64MembershipTests n =
  bench ("vec word64 " ++ show n) $
    nf (V.elem (downgrade exampleDest)) (vec64Dests n)

set64MembershipTests :: Int -> Benchmark
set64MembershipTests n =
  bench ("set word64 " ++ show n) $
    nf (S.member (downgrade exampleDest)) (set64Dests n)

-- | Every opcode is a JUMPDEST
getJumpDestsTime :: Int -> Benchmark
getJumpDestsTime n =
  bench ("getJumpDests " ++ show n) $
    nf getValidJUMPDESTs (Code $ B.replicate n 0x5b)

-- | None of the opcodes are a jumpdest
getJumpDestsMissTime :: Int -> Benchmark
getJumpDestsMissTime n =
  bench ("getJumpDestsMissTime" ++ show n) $
    nf getValidJUMPDESTs (Code $ B.replicate n 0x00)

-- Stack benchmarks

newtype OldStack = OldStack [Word256] deriving (Show, Eq, Generic, NFData)

emptyOld :: OldStack
emptyOld = OldStack []

pushOld :: Word256 -> OldStack -> Maybe OldStack
pushOld x (OldStack xs) =
  if length xs == 1024
    then Nothing
    else Just $ OldStack (x : xs)

popOld :: OldStack -> Maybe (Word256, OldStack)
popOld (OldStack []) = Nothing
popOld (OldStack (x : xs)) = Just (x, OldStack xs)

peekOld :: OldStack -> Maybe Word256
peekOld = fmap fst . popOld

swapOld :: Int -> OldStack -> Maybe OldStack
swapOld i (OldStack os)
  | i >= length os = Nothing
  | otherwise =
    let (v1, middle, v2, rest) = case splitAt i os of
          (v1' : middle', v2' : rest') -> (v1', middle', v2', rest')
          _ -> error "impossible"
     in Just $! OldStack $! (v2 : middle) ++ (v1 : rest)

getOld :: Int -> OldStack -> Maybe Word256
getOld i (OldStack xs)
  | i >= length xs = Nothing
  | otherwise = Just $ xs !! i

dupOld :: Int -> OldStack -> Maybe OldStack
dupOld i ss = do
  x <- getOld i ss
  pushOld x ss

oldStackFullPush :: Int -> Benchmark
oldStackFullPush n =
  bench ("old stack pushing " ++ show n) $
    nf (pushAllOld emptyOld) [0 .. fromIntegral n]

pushAllOld :: OldStack -> [Word256] -> Maybe OldStack
pushAllOld os [] = Just os
pushAllOld os (x : xs) = do
  os' <- pushOld x os
  pushAllOld os' xs

swapNOld :: Int -> Benchmark
swapNOld n =
  bench ("swapping old; depth = " ++ show n) $
    nf (swapOld n) (OldStack [1 .. 100])

mutableFullPush :: MS.MutableStack Word256 -> Int -> Benchmark
mutableFullPush s n =
  bench ("mutable stack pushing " ++ show n)
    . nfIO
    $ mapM_ (MS.push s) [0 .. fromIntegral n]

swapNMutable :: MS.MutableStack Word256 -> Int -> Benchmark
swapNMutable s n =
  bench ("swapping mutable; depth = " ++ show n)
    . nfIO
    $ MS.swap s n

defaultStack :: IO (MS.MutableStack Word256)
defaultStack = do
  s <- MS.empty
  mapM_ (MS.push s) [1 .. 100]
  return s

mutableStackCreation :: Benchmark
mutableStackCreation = bench "mutable stack creation" . nfIO . void $ MS.empty

main :: IO ()
main = do
  let stackSizes = [1, 32, 128, 1024]
  let swapSizes = [1, 4, 16]
  [es1, es2, es3, es4] <- replicateM 4 MS.empty
  [s1, s2, s3] <- replicateM 3 defaultStack

  let jumpSizes = [256, 4096, 32768]
  let codeSizes = [10, 100000, 1000000]
  defaultMain
    [ bgroup "Stacks" $
        map oldStackFullPush stackSizes
          ++ [ mutableFullPush es1 1,
               mutableFullPush es2 32,
               mutableFullPush es3 128,
               mutableFullPush es4 1024
             ]
          ++ map swapNOld swapSizes
          ++ [swapNMutable s1 1, swapNMutable s2 4, swapNMutable s3 16],
      bgroup "JumpDests" $
        map list256MembershipTests jumpSizes
          ++ map vec256MembershipTests jumpSizes
          ++ map set256MembershipTests jumpSizes
          ++ map list64MembershipTests jumpSizes
          ++ map vec64MembershipTests jumpSizes
          ++ map set64MembershipTests jumpSizes
          ++ map intsetMembershipTests jumpSizes
          ++ map getJumpDestsTime codeSizes
          ++ map getJumpDestsMissTime codeSizes
    ]
