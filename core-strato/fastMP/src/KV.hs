module KV (
  KV(..),
  Value(..),
  c2n,
  formatKV
  ) where


--import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.NibbleString as N

--import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia.NodeData as MP


data NodePtr = NodePtr String deriving Show

--data Node = KVNode String Value deriving Show

data KV = KV {
  theKey :: BC.ByteString,
  theValue :: Either MP.NodeRef MP.Val
  } deriving Show

data Value = StringValue String | NodePtrValue MP.NodeRef deriving Show




--------------------



formatKV :: KV -> String
formatKV (KV key (Right v)) = BC.unpack key ++ " " ++ show v
formatKV (KV key (Left (MP.PtrRef np))) = BC.unpack key ++ " node:(" ++ show np ++ ")"
formatKV (KV key (Left (MP.SmallRef np))) = BC.unpack key ++ " small:(" ++ show np ++ ")"



c2n :: Char -> N.Nibble
c2n '0' = 0
c2n '1' = 1
c2n '2' = 2
c2n '3' = 3
c2n '4' = 4
c2n '5' = 5
c2n '6' = 6
c2n '7' = 7
c2n '8' = 8
c2n '9' = 9
c2n 'a' = 0xa
c2n 'b' = 0xb
c2n 'c' = 0xc
c2n 'd' = 0xd
c2n 'e' = 0xe
c2n 'f' = 0xf
c2n x = error $ "Non-nibble character in call to c2n: " ++ show x
