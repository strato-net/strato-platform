{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE TypeSynonymInstances #-}

module Blockchain.Database.MerklePatricia.NodeData (
  Key,
  Val,
  NodeData(..),
  NodeRef(..),
  emptyRef
  ) where

import           Data.Bifunctor                               (first)
import           Data.Bits
import qualified Data.ByteString                              as B
import qualified Data.ByteString.Base16                       as B16
import qualified Data.ByteString.Char8                        as BC
import           Data.Functor.Compose
import           Data.Functor.Identity
import qualified Data.NibbleString                            as N
import           Numeric
import           Text.PrettyPrint.ANSI.Leijen                 hiding ((<$>))

import           Blockchain.Data.RLP
import           Blockchain.Database.MerklePatricia.StateRoot
import           Text.Format

-------------------------

-- | The type of the database key
type Key = N.NibbleString

-- | The type of the values in the database
type Val = RLPObject

-------------------------

data NodeRefF a = SmallRef B.ByteString | PtrRef a deriving (Show, Eq)

type NodeRef = NodeRefF StateRoot

emptyRef::NodeRef
emptyRef = SmallRef $ B.pack [0x80]

instance Pretty NodeRef where
  pretty (SmallRef x) = green $ text $ BC.unpack $ B16.encode x
  pretty (PtrRef (Identity x))   = green $ text $ format x

-------------------------

data NodeDataF a = EmptyNodeData
                 | FullNodeData {
                    -- Why not make choices a map (choices::M.Map N.Nibble NodeRef)?  Because this type tends to be created
                    -- more than items are looked up in it....  It would actually slow things down to use it.
                    choices :: [Either B.ByteString a],
                    nodeVal :: Maybe Val
                   }
                 | ShortcutNodeData {
                     nextNibbleString :: Key,
                     nextVal          :: Either (Either B.ByteString a) Val
                   }
                 deriving (Show, Eq)

type NodeData = NodeDataF StateRoot
type NodeDataProof = Compose ((,) StateRoot) (Compose Maybe NodeDataF)

newtype Fix f = Fix { unFix :: f (Fix f) }

type Algebra f a = f a -> a

cata :: Functor f => Algebra f a -> Fix f -> a
cata alg = alg . fmap (cata alg) . unFix

unproofNodeData :: NodeDataF (StateRoot, a) -> NodeData
unproofNodeData EmptyNodeData = EmptyNodeData
unproofNodeData (FullNodeData cs v) = FullNodeData (fmap fst <$> cs) v
unproofNodeData (ShortcutNodeData k v) = ShortcutNodeData k $ first (fmap fst) v

valid :: Either a (b, Bool) -> Bool
valid (Right (_, b)) = b
valid _              = True

verifyNodeDataProof :: Algebra NodeDataProof (StateRoot, Bool)
verifyNodeDataProof (Compose (sr, inner)) = (sr, verifyInner inner)
  where verifyInner (Compose (Just nd@(FullNodeData cs _))) =
          let s = StateRoot . keccak256ToByteString . rlpHash $ unproofNodeData nd
              b = all valid cs
           in s == sr && b
        verifyInner (Compose (Just nd@(ShortcutNodeData _ (Left b)))) =
          let s = StateRoot . keccak256ToByteString . rlpHash $ unproofNodeData nd
              b = all valid cs
           in s == sr & b
verifyNodeDataProof (Compose (sr, _)) = (sr, True)

verifyMP :: Fix NodeDataProof -> Bool
verifyMP = snd . cata verifyNodeDataProof

formatVal::Maybe RLPObject->Doc
formatVal Nothing  = red $ text "NULL"
formatVal (Just x) = green $ pretty x

instance Pretty a => Pretty (NodeDataF a) where
  pretty EmptyNodeData = text "    <EMPTY>"
  pretty (ShortcutNodeData s (Left p)) = text $ "    " ++ show (pretty s) ++ " -> " ++ show (pretty p)
  pretty (ShortcutNodeData s (Right val)) = text $ "    " ++ show (pretty s) ++ " -> " ++ show (green $ pretty val)
  pretty (FullNodeData cs val) = text "    val: " </> formatVal val </> text "\n        " </> vsep (showChoice <$> zip ([0..]::[Int]) cs)
    where
      showChoice :: Pretty a => (Int, Either B.ByteString a) -> Doc
      showChoice (v, Left "") = blue (text $ showHex v "") </> text ": " </> red (text "NULL")
      showChoice (v, p)       = blue (text $ showHex v "") </> text ": " </> green (pretty p)

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
      encodeVal :: RLPSerializable a => Either (Either B.ByteString a) Val -> RLPObject
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
      getPtr :: RLPSerializable a => RLPObject -> Either B.ByteString a
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
