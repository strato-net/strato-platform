{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE UndecidableInstances #-}

module Blockchain.Database.MerklePatricia.NodeData
  ( Key,
    Val,
    NodeDataF (..),
    NodeData,
    NodeDataProof,
    MPProof,
    NodeRefF,
    NodeRef,
    runMP,
    initializeBlank,
    smallRef,
    ptrRef,
    emptyRef,
    proveMP,
    verifyMP,
    module Data.Ranged,
  )
where

import Blockchain.Data.RLP
import Blockchain.Database.MerklePatricia.StateRoot
import Blockchain.Strato.Model.Keccak256
import Control.Monad (liftM)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.State
import Data.Bifunctor (first)
import qualified Data.Binary as Bin
import Data.Bitraversable (bitraverse)
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Fix
import Data.Functor.Compose
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import qualified Data.NibbleString as N
import Data.Ranged
import GHC.Generics
import Numeric
import Test.QuickCheck hiding ((.&.))
import Text.Colors
import Text.Format

-------------------------

-- | The type of the database key
type Key = N.NibbleString

type KeyRange = RSet Key

-- | The type of the values in the database
type Val = RLPObject

-------------------------

type NodeRefF a = Either B.ByteString a

type NodeRef = NodeRefF StateRoot

smallRef :: B.ByteString -> NodeRefF a
smallRef = Left

ptrRef :: a -> NodeRefF a
ptrRef = Right

emptyRef :: NodeRefF a
emptyRef = Left $ B.pack [0x80]

-------------------------

data NodeDataF a
  = EmptyNodeData
  | FullNodeData
      { -- Why not make choices a map (choices::M.Map N.Nibble NodeRef)?  Because this type tends to be created
        -- more than items are looked up in it....  It would actually slow things down to use it.
        choices :: [NodeRefF a],
        nodeVal :: Maybe Val
      }
  | ShortcutNodeData
      { nextNibbleString :: Key,
        nextVal :: Either (NodeRefF a) Val
      }
  deriving (Show, Eq, Generic)

instance Functor NodeDataF where
  fmap _ EmptyNodeData = EmptyNodeData
  fmap f (FullNodeData cs v) = FullNodeData (fmap f <$> cs) v
  fmap f (ShortcutNodeData k v) = ShortcutNodeData k (first (fmap f) v)

instance Foldable NodeDataF where
  foldMap _ EmptyNodeData = mempty
  foldMap f (FullNodeData cs _) = mconcat $ either (const mempty) f <$> cs
  foldMap f (ShortcutNodeData _ v) = either (either (const mempty) f) (const mempty) v

instance Traversable NodeDataF where
  traverse _ EmptyNodeData = pure EmptyNodeData
  traverse f (FullNodeData cs v) = flip FullNodeData v <$> traverse (traverse f) cs
  traverse f (ShortcutNodeData k v) = ShortcutNodeData k <$> bitraverse (traverse f) pure v

instance Bin.Binary NodeData where
  get = rlpDecode . rlpDeserialize <$> Bin.get
  put = Bin.put . rlpSerialize . rlpEncode

instance Arbitrary NodeData where
  arbitrary = pure EmptyNodeData -- TODO? make real instance?

instance Monad m => (StateRoot `A.Alters` NodeData) (StateT (Map StateRoot NodeData) m) where
  lookup _ k = M.lookup k <$> get
  insert _ k v = modify' $ M.insert k v
  delete _ k = modify' $ M.delete k

formatVal :: Maybe RLPObject -> String
formatVal Nothing = red "NULL"
formatVal (Just x) = green $ format x

instance Format a => Format (NodeDataF a) where
  format EmptyNodeData = "    <EMPTY>"
  format (ShortcutNodeData s (Left (Left p))) = "    " ++ format s ++ " -> " ++ (green . BC.unpack $ B16.encode p)
  format (ShortcutNodeData s (Left (Right v))) = "    " ++ format s ++ " -> " ++ format v
  format (ShortcutNodeData s (Right val)) = "    " ++ format s ++ " -> " ++ green (format val)
  format (FullNodeData cs val) = "    val: " ++ formatVal val ++ "\n        " ++ unlines (showChoice <$> zip ([0 ..] :: [Int]) cs)
    where
      showChoice :: Format a => (Int, NodeRefF a) -> String
      showChoice (v, Left "") = blue (showHex v "") ++ ": " ++ red "NULL"
      showChoice (v, Left p) = blue (showHex v "") ++ ": " ++ green (BC.unpack $ B16.encode p)
      showChoice (v, Right p) = blue (showHex v "") ++ ": " ++ green (format p)

instance RLPSerializable1 NodeDataF where
  liftRlpEncode _ EmptyNodeData = RLPString ""
  liftRlpEncode f (FullNodeData {choices = cs, nodeVal = val}) = RLPArray ((encodeChoice f <$> cs) ++ [encodeVal val])
    where
      encodeChoice :: (b -> RLPObject) -> NodeRefF b -> RLPObject
      encodeChoice _ (Left "") = rlpEncode (0 :: Integer)
      encodeChoice g (Right x) = g x
      encodeChoice _ (Left o) = rlpDeserialize o
      encodeVal :: Maybe Val -> RLPObject
      encodeVal Nothing = rlpEncode (0 :: Integer)
      encodeVal (Just x) = x
  liftRlpEncode f (ShortcutNodeData {nextNibbleString = s, nextVal = val}) =
    RLPArray [rlpEncode $ termNibbleString2String terminator s, encodeVal f val]
    where
      terminator =
        case val of
          Left _ -> False
          Right _ -> True
      encodeVal :: (b -> RLPObject) -> Either (NodeRefF b) Val -> RLPObject
      encodeVal g (Left (Right x)) = g x
      encodeVal _ (Left (Left x)) = rlpDeserialize x
      encodeVal _ (Right x) = x

  liftRlpDecode _ (RLPString "") = EmptyNodeData
  liftRlpDecode _ (RLPScalar 0) = EmptyNodeData
  liftRlpDecode f (RLPArray [a, val])
    | terminator = ShortcutNodeData s $ Right val
    | B.length (rlpSerialize val) >= 32 =
      ShortcutNodeData s (Left . ptrRef $ f val)
    | otherwise =
      ShortcutNodeData s (Left . smallRef $ rlpSerialize val)
    where
      (terminator, s) = byteString2TermNibbleString . rlpDecode $ a
  liftRlpDecode f (RLPArray x)
    | length x == 17 =
      FullNodeData (getPtr f <$> childPointers) val
    where
      childPointers = init x
      val = case last x of
        RLPScalar 0 -> Nothing
        RLPString "" -> Nothing
        x' -> Just x'
      getPtr :: (RLPObject -> b) -> RLPObject -> NodeRefF b
      getPtr _ o | B.length (rlpSerialize o) < 32 = Left $ rlpSerialize o
      --getPtr o@(RLPArray [_, _]) = SmallRef $ rlpSerialize o
      getPtr g p = Right $ g p
  liftRlpDecode _ x = error ("Missing case in rlpDecode for NodeData: " ++ show x)

instance RLPSerializable a => RLPSerializable (NodeDataF a) where
  rlpEncode = rlpEncode1
  rlpDecode = rlpDecode1

byteString2TermNibbleString :: B.ByteString -> (Bool, N.NibbleString)
byteString2TermNibbleString bs
  | B.null bs = error "string2TermNibbleString called with empty String"
  | otherwise = (terminator, ns)
  where
    w = B.head bs
    rest = B.tail bs
    (flags, extraNibble) = if w > 0xF then (w `shiftR` 4, 0xF .&. w) else (w, 0)
    terminator = flags `shiftR` 1 == 1
    oddLength = flags .&. 1 == 1
    ns = if oddLength then N.OddNibbleString extraNibble rest else N.EvenNibbleString rest

termNibbleString2String :: Bool -> N.NibbleString -> B.ByteString
termNibbleString2String terminator s =
  case s of
    (N.EvenNibbleString s') -> B.singleton (extraNibble `shiftL` 4) `B.append` s'
    (N.OddNibbleString n rest) -> B.singleton (extraNibble `shiftL` 4 + n) `B.append` rest
  where
    extraNibble =
      (if terminator then 2 else 0)
        + (if odd $ N.length s then 1 else 0)

runMP :: Monad m => StateT (M.Map StateRoot NodeData) m a -> m a
runMP f = evalStateT (initializeBlank >> f) M.empty

-- | Initialize the DB by adding a blank stateroot.
initializeBlank ::
  (StateRoot `A.Alters` NodeData) m =>
  m ()
initializeBlank = A.insert A.Proxy emptyTriePtr (EmptyNodeData :: NodeData)

newtype Proof a = Proof {unProof :: (StateRoot, Maybe a)} deriving (Eq, Show, Functor)

instance Foldable Proof where
  foldMap f (Proof (_, Just a)) = f a
  foldMap _ _ = mempty

instance Traversable Proof where
  traverse f (Proof (sr, a)) = Proof . (sr,) <$> traverse f a

instance RLPSerializable1 Proof where
  liftRlpEncode f (Proof (sr, a)) = RLPArray [rlpEncode sr, liftRlpEncode f a]
  liftRlpDecode f (RLPArray [sr', a']) =
    let !sr = rlpDecode sr'
        !a = liftRlpDecode f a'
     in Proof (sr, a)
  liftRlpDecode _ o = error $ "rlpDecode Proof: Expected RLPArray [sr, a], got " ++ show o

instance RLPSerializable a => RLPSerializable (Proof a) where
  rlpEncode = rlpEncode1
  rlpDecode = rlpDecode1

type NodeData = NodeDataF StateRoot

type NodeDataProof = Compose Proof NodeDataF

type MPProof = Fix NodeDataProof

padKey :: N.NibbleString -> N.NibbleString
padKey (N.EvenNibbleString n) = N.EvenNibbleString $ B.take 32 $ n `B.append` B.replicate 32 0
padKey n = N.pack . take 64 . (++ repeat 0) $ N.unpack n

proveNodeData :: (StateRoot `A.Alters` NodeData) m => KeyRange -> (Key, StateRoot) -> m (NodeDataProof (Either MPProof (Key, StateRoot)))
proveNodeData range (key, sr) = Compose . Proof . (sr,) . fmap appendKey <$> A.lookup A.Proxy sr
  where
    appendKey EmptyNodeData = EmptyNodeData
    appendKey (FullNodeData cs v) =
      let cs' = zipWith zipRight [0 ..] cs
          zipRight k (Right r) =
            let kn = N.append key $ N.pack [k]
             in ptrRef $
                  if range `rSetHas` padKey kn
                    then Right (kn, r)
                    else Left . Fix . Compose $ Proof (r, Nothing)
          zipRight _ (Left l) = smallRef l
       in FullNodeData cs' v
    appendKey (ShortcutNodeData k (Left (Right r))) =
      let kn = key `N.append` k
       in ShortcutNodeData k . Left . ptrRef $
            if range `rSetHas` padKey kn
              then Right (kn, r)
              else Left . Fix . Compose $ Proof (r, Nothing)
    appendKey (ShortcutNodeData k (Left (Left v))) = ShortcutNodeData k (Left $ smallRef v)
    appendKey (ShortcutNodeData k (Right v)) = ShortcutNodeData k (Right v)

apoM :: (Monad m, Traversable t) => (a -> m (t (Either (Fix t) a))) -> a -> m (Fix t)
apoM f = go where go = liftM Fix . (traverse (either pure go) =<<) . f

proveMP :: (StateRoot `A.Alters` NodeData) m => KeyRange -> StateRoot -> m MPProof
proveMP range = apoM (proveNodeData range) . (N.empty,)

unproofNodeData :: NodeDataF (StateRoot, a) -> NodeData
unproofNodeData EmptyNodeData = EmptyNodeData
unproofNodeData (FullNodeData cs v) = FullNodeData (fmap fst <$> cs) v
unproofNodeData (ShortcutNodeData k v) = ShortcutNodeData k $ first (fmap fst) v

verifyNodeData :: NodeDataProof (StateRoot, Bool) -> (StateRoot, Bool)
verifyNodeData (Compose (Proof (sr, inner))) = (sr, verifyInner inner)
  where
    verifyInner (Just nd@(FullNodeData cs _)) =
      let s = StateRoot . keccak256ToByteString . rlpHash $ unproofNodeData nd
          b = all valid cs
       in s == sr && b
    verifyInner (Just nd@(ShortcutNodeData _ (Left c))) =
      let s = StateRoot . keccak256ToByteString . rlpHash $ unproofNodeData nd
          b = valid c
       in s == sr && b
    verifyInner _ = True

    valid :: Either a (b, Bool) -> Bool
    valid (Right (_, b)) = b
    valid _ = True

verifyMP :: MPProof -> Bool
verifyMP = snd . foldFix verifyNodeData
