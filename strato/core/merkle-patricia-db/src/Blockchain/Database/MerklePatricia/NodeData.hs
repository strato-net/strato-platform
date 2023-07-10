{-# LANGUAGE DeriveFunctor         #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE UndecidableInstances  #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}

module Blockchain.Database.MerklePatricia.NodeData (
  Key,
  Val,
  NodeDataF(..),
  NodeData,
  NodeDataProof,
  NodeRefF,
  NodeRef,
  runMP,
  initializeBlank,
  smallRef,
  ptrRef,
  emptyRef,
  verifyNodeDataProof,
  verifyMP
  ) where

import qualified Control.Monad.Change.Alter                   as A
import           Control.Monad.State
import           Data.Bifunctor                               (first)
import           Data.Bits
import qualified Data.ByteString                              as B
import qualified Data.ByteString.Base16                       as B16
import qualified Data.ByteString.Char8                        as BC
import           Data.Fix
import           Data.Functor.Compose
import           Data.Map.Strict                              (Map)
import qualified Data.Map.Strict                              as M
import qualified Data.NibbleString                            as N
import           Numeric
import           Text.PrettyPrint.ANSI.Leijen                 hiding ((<$>))

import           Blockchain.Data.RLP
import           Blockchain.Database.MerklePatricia.StateRoot
import           Blockchain.Strato.Model.Keccak256

-------------------------

-- | The type of the database key
type Key = N.NibbleString

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

data NodeDataF a = EmptyNodeData
                 | FullNodeData {
                    -- Why not make choices a map (choices::M.Map N.Nibble NodeRef)?  Because this type tends to be created
                    -- more than items are looked up in it....  It would actually slow things down to use it.
                    choices :: [NodeRefF a],
                    nodeVal :: Maybe Val
                   }
                 | ShortcutNodeData {
                     nextNibbleString :: Key,
                     nextVal          :: Either (NodeRefF a) Val
                   }
                 deriving (Show, Eq)

instance Functor NodeDataF where
  fmap _ EmptyNodeData = EmptyNodeData
  fmap f (FullNodeData cs v) = FullNodeData (fmap f <$> cs) v
  fmap f (ShortcutNodeData k v) = ShortcutNodeData k (first (fmap f) v)

instance Monad m => (StateRoot `A.Alters` NodeData) (StateT (Map StateRoot NodeData) m) where
  lookup _ k   = M.lookup k <$> get
  insert _ k v = modify' $ M.insert k v
  delete _ k   = modify' $ M.delete k

runMP :: Monad m => StateT (M.Map StateRoot NodeData) m a -> m a
runMP f = evalStateT (initializeBlank >> f) M.empty

-- | Initialize the DB by adding a blank stateroot.
initializeBlank :: (StateRoot `A.Alters` NodeData) m
                => m ()
initializeBlank = A.insert A.Proxy emptyTriePtr (EmptyNodeData :: NodeData)

newtype Proof a = Proof { unProof :: (StateRoot, Maybe a) } deriving (Eq, Show, Functor)

type NodeData = NodeDataF StateRoot
type NodeDataProof = Compose Proof NodeDataF

unproofNodeData :: NodeDataF (StateRoot, a) -> NodeData
unproofNodeData EmptyNodeData = EmptyNodeData
unproofNodeData (FullNodeData cs v) = FullNodeData (fmap fst <$> cs) v
unproofNodeData (ShortcutNodeData k v) = ShortcutNodeData k $ first (fmap fst) v

valid :: Either a (b, Bool) -> Bool
valid (Right (_, b)) = b
valid _              = True

verifyNodeDataProof :: NodeDataProof (StateRoot, Bool) -> (StateRoot, Bool)
verifyNodeDataProof (Compose (Proof (sr, inner))) = (sr, verifyInner inner)
  where verifyInner (Just nd@(FullNodeData cs _)) =
          let s = StateRoot . keccak256ToByteString . rlpHash $ unproofNodeData nd
              b = all valid cs
           in s == sr && b
        verifyInner (Just nd@(ShortcutNodeData _ (Left c))) =
          let s = StateRoot . keccak256ToByteString . rlpHash $ unproofNodeData nd
              b = valid c
           in s == sr && b
        verifyInner _ = True

verifyMP :: Fix NodeDataProof -> Bool
verifyMP = snd . foldFix verifyNodeDataProof

formatVal::Maybe RLPObject->Doc
formatVal Nothing  = red $ text "NULL"
formatVal (Just x) = green $ pretty x

instance Pretty a => Pretty (NodeDataF a) where
  pretty EmptyNodeData = text "    <EMPTY>"
  pretty (ShortcutNodeData s (Left (Left p))) = text $ "    " ++ show (pretty s) ++ " -> " ++ show (green . text . BC.unpack $ B16.encode p)
  pretty (ShortcutNodeData s (Left (Right v))) = text $ "    " ++ show (pretty s) ++ " -> " ++ show (pretty v)
  pretty (ShortcutNodeData s (Right val)) = text $ "    " ++ show (pretty s) ++ " -> " ++ show (green $ pretty val)
  pretty (FullNodeData cs val) = text "    val: " </> formatVal val </> text "\n        " </> vsep (showChoice <$> zip ([0..]::[Int]) cs)
    where
      showChoice :: Pretty a => (Int, Either B.ByteString a) -> Doc
      showChoice (v, Left "") = blue (text $ showHex v "") </> text ": " </> red (text "NULL")
      showChoice (v, Left p)  = blue (text $ showHex v "") </> text ": " </> green (text . BC.unpack $ B16.encode p)
      showChoice (v, Right p) = blue (text $ showHex v "") </> text ": " </> green (pretty p)

instance RLPSerializable a => RLPSerializable (NodeDataF a) where
  rlpEncode EmptyNodeData = RLPString ""
  rlpEncode (FullNodeData {choices=cs, nodeVal=val}) = RLPArray ((encodeChoice <$> cs) ++ [encodeVal val])
    where
      encodeChoice :: RLPSerializable a => Either B.ByteString a -> RLPObject
      encodeChoice (Left "") = rlpEncode (0::Integer)
      encodeChoice (Right x) = rlpEncode x
      encodeChoice (Left o)  = rlpDeserialize o
      encodeVal :: Maybe Val -> RLPObject
      encodeVal Nothing  = rlpEncode (0::Integer)
      encodeVal (Just x) = x
  rlpEncode (ShortcutNodeData {nextNibbleString=s, nextVal=val}) =
    RLPArray[rlpEncode $ termNibbleString2String terminator s, encodeVal val]
    where
      terminator =
        case val of
          Left _  -> False
          Right _ -> True
      encodeVal :: RLPSerializable a => Either (NodeRefF a) Val -> RLPObject
      encodeVal (Left (Right x)) = rlpEncode x
      encodeVal (Left (Left x))  = rlpDeserialize x
      encodeVal (Right x)        = x

  rlpDecode (RLPString "") = EmptyNodeData
  rlpDecode (RLPScalar 0) = EmptyNodeData
  rlpDecode (RLPArray [a, val])
      | terminator = ShortcutNodeData s $ Right val
      | B.length (rlpSerialize val) >= 32 =
          ShortcutNodeData s (Left $ Right $ rlpDecode val)
      | otherwise =
          ShortcutNodeData s (Left $ Left $ rlpSerialize val)
    where
      (terminator, s) = byteString2TermNibbleString . rlpDecode $ a
  rlpDecode (RLPArray x) | length x == 17 =
    FullNodeData (getPtr <$> childPointers) val
    where
      childPointers = init x
      val = case last x of
        RLPScalar 0  -> Nothing
        RLPString "" -> Nothing
        x'           -> Just x'
      getPtr :: RLPSerializable a => RLPObject -> NodeRefF a
      getPtr o | B.length (rlpSerialize o) < 32 = Left $ rlpSerialize o
      --getPtr o@(RLPArray [_, _]) = SmallRef $ rlpSerialize o
      getPtr p = Right $ rlpDecode p
  rlpDecode x = error ("Missing case in rlpDecode for NodeData: " ++ show x)

byteString2TermNibbleString :: B.ByteString -> (Bool, N.NibbleString)
byteString2TermNibbleString bs | B.null bs   = error "string2TermNibbleString called with empty String"
                               | otherwise = (terminator, ns)
    where
        w = B.head bs
        rest = B.tail bs
        (flags, extraNibble) = if w > 0xF then (w `shiftR` 4, 0xF .&. w) else (w, 0)
        terminator = flags `shiftR` 1 == 1
        oddLength = flags .&. 1 == 1
        ns = if oddLength then N.OddNibbleString extraNibble rest else N.EvenNibbleString rest

termNibbleString2String::Bool->N.NibbleString->B.ByteString
termNibbleString2String terminator s =
  case s of
    (N.EvenNibbleString s')    -> B.singleton (extraNibble `shiftL` 4) `B.append` s'
    (N.OddNibbleString n rest) -> B.singleton (extraNibble `shiftL` 4 + n) `B.append` rest
  where
    extraNibble =
        (if terminator then 2 else 0) +
        (if odd $ N.length s then 1 else 0)
