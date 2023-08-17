module KV
  ( KV (..),
    Value (..),
    c2n,
    formatKV,
  )
where

--import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia.NodeData as MP
import qualified Data.NibbleString as N

data NodePtr = NodePtr String deriving (Show)

--data Node = KVNode String Value deriving Show

data KV = KV
  { theKey :: [N.Nibble],
    theValue :: Either MP.NodeRef MP.Val
  }
  deriving (Show)

data Value = StringValue String | NodePtrValue MP.NodeRef deriving (Show)

--------------------

formatKV :: KV -> String
formatKV (KV key (Right v)) = map n2c key ++ " " ++ show v
formatKV (KV key (Left (Right np))) = map n2c key ++ " node:(" ++ show np ++ ")"
formatKV (KV key (Left (Left np))) = map n2c key ++ " small:(" ++ show np ++ ")"

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

n2c :: N.Nibble -> Char
n2c 0 = '0'
n2c 1 = '1'
n2c 2 = '2'
n2c 3 = '3'
n2c 4 = '4'
n2c 5 = '5'
n2c 6 = '6'
n2c 7 = '7'
n2c 8 = '8'
n2c 9 = '9'
n2c 0xa = 'a'
n2c 0xb = 'b'
n2c 0xc = 'c'
n2c 0xd = 'd'
n2c 0xe = 'e'
n2c 0xf = 'f'
n2c x = error $ "Non-nibble character in call to n2c: " ++ show x
