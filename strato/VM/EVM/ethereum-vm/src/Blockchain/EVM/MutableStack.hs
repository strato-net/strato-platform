{-# LANGUAGE BangPatterns #-}

module Blockchain.EVM.MutableStack where

import Control.DeepSeq
import Control.Monad
import Data.IORef.Unboxed
import qualified Data.Vector as V
import qualified Data.Vector.Mutable as MV
import qualified Data.Vector.Mutable as V

{-# INLINE stackMax #-}
stackMax :: Int
stackMax = 1024

-- A mutable stack specialized to the EVM. It has an intentional
-- max size of 1024 elements, and dup/swap instructions are limited
-- to a reach of 16. Note that this type is not thread safe:
--   race_ (push s 17) (push s 20)
-- is undefined behavior.
data MutableStack a = MutableStack
  { stackPointer :: Counter, -- Points to the lowest element on the stack
    payload :: V.IOVector a
  }

instance (Show a) => Show (MutableStack a) where
  show _ = "<mutable stack>"

instance NFData (MutableStack a) where
  rnf (MutableStack spref p) = spref `seq` p `seq` ()

toList :: MutableStack a -> IO [a]
toList (MutableStack spref p) = do
  off <- readIORefU spref
  sl <- V.freeze $ MV.slice off (1024 - off) p
  return $! V.toList sl

empty :: IO (MutableStack a)
empty = liftM2 MutableStack (newCounter stackMax) (V.new stackMax)

isEmpty :: MutableStack a -> IO Bool
isEmpty = fmap (== stackMax) . readIORefU . stackPointer

-- | Insert a new SP[0]
push :: MutableStack a -> a -> IO Bool
push (MutableStack spref p) !n = do
  off <- readIORefU spref
  if off == 0
    then return False
    else do
      newBottom <- atomicSubCounter spref 1
      V.unsafeWrite p newBottom n
      return True

-- | Returns the item at SP[0] and removes it from the stack.
pop :: MutableStack a -> IO (Maybe a)
pop (MutableStack spref p) = do
  off <- readIORefU spref
  if off == stackMax
    then return Nothing
    else do
      n <- V.unsafeRead p off
      void $ atomicAddCounter spref 1
      return (Just n)

-- | Duplicates the item at SP[k]
dup :: MutableStack a -> Int -> IO Bool
dup (MutableStack spref p) k = do
  off <- readIORefU spref
  if off == 0 || off + k >= stackMax || k > 15 || k < 0
    then return False
    else do
      n <- V.read p (off + k)
      newOff <- atomicSubCounter spref 1
      V.unsafeWrite p newOff n
      return True

-- | Swaps the item at SP[0] and SP[k+1]
swap :: MutableStack a -> Int -> IO Bool
swap (MutableStack spref p) k = do
  off <- readIORefU spref
  if off + k + 1 >= stackMax || k > 15 || k < 0
    then return False
    else do
      V.unsafeSwap p off (off + 1 + k)
      return True

-- | Gets the item at SP[k]
get :: MutableStack a -> Int -> IO (Maybe a)
get (MutableStack spref p) k = do
  off <- readIORefU spref
  if off + k >= stackMax || k < 0
    then return Nothing
    else Just <$> V.unsafeRead p (off + k)
