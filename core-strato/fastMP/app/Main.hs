{-# LANGUAGE OverloadedStrings #-}

module Main (
  main
  ) where

import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Trans.Resource
--import Crypto.Hash.Keccak
import qualified Data.ByteString.Base16 as B16
import Data.ByteString.Char8 (ByteString)
import qualified Data.ByteString.Char8 as BC
import Data.Conduit
--import Data.List
import qualified Data.NibbleString as N

import Blockchain.Data.RLP
import Text.PrettyPrint.ANSI.Leijen                 hiding ((<$>))

import qualified Blockchain.Database.MerklePatricia.NodeData as MP
import qualified Blockchain.Database.MerklePatricia.StateRoot as MP
--import Blockchain.Format

import Blockchain.Strato.Model.SHA (keccak256)

import KV
import LevelDBTools

debug :: Bool
debug = True

decodeVal :: ByteString -> ByteString
decodeVal x =
  case B16.decode x of
    (v, "") -> v
    _ -> error $ "you are trying to decode a value that is not base16 encoded: " ++ show x

main :: IO ()
main = do
  c <- fmap (map BC.words . BC.lines) $ BC.getContents
  let input = map (\[x, y] -> KV x $ Right (RLPString . rlpSerialize . RLPString . decodeVal $ y)) c
--  let input = map (\[x, y] -> KV x $ Right (RLPString . fst . B16.decode $ y)) c

--  doit (input, []) $$ kvToStdout
  runResourceT $ runConduit $ doit (input, []) .| outputToLDB

{-
kvToStdout :: MonadIO m => Sink LevelKV m ()
kvToStdout = do
  input <- await
  case input of
    Just (LevelKV k v) -> do
      liftIO $ putStrLn $ BC.unpack (B16.encode k) ++ " " ++ BC.unpack (B16.encode v)
      kvToStdout
    Nothing -> return ()
-}

doit :: MonadIO m => ([KV], [(ByteString, PartialNode)]) -> ConduitT () LevelKV m ()
doit x = do
  next <- processNext x
  case next of
    ([], []) -> return ()
    _ -> doit next  

data NodePtr = NodePtr String deriving Show

data PartialNode =
  PartialNode {
  branches::[(N.Nibble, MP.NodeRef)],
  value::Maybe RLPObject
  } deriving Show

partialToNode :: PartialNode -> MP.NodeData
partialToNode (PartialNode b v) =
  MP.FullNodeData (spreadOut b [0..15]) v
  where
    spreadOut :: [(N.Nibble, MP.NodeRef)] -> [N.Nibble] -> [MP.NodeRef]
    spreadOut ((k, val):rest) (k2:rest2) | k == k2 = val:spreadOut rest rest2
    spreadOut input (_:rest2) = MP.emptyRef:spreadOut input rest2
    spreadOut [] [] = []
    spreadOut _ [] = error "internal error: spreadOut was given input out of order or out of range"
    

processNext :: MonadIO m => ([KV], [(ByteString, PartialNode)])->ConduitM () LevelKV m ([KV], [(ByteString, PartialNode)])

--Create new Partial Node
processNext x@((KV k1 v1:second@(KV k2 _):rest), partials) | shouldCreate x = do
  let v1' =
        case v1 of
          Right tempStr -> Right tempStr
          Left val -> Left val

                                                               
  let (prefix, (fkey, _)) = splitPrefix k1 k2

  partialNode <- addToPartial PartialNode{branches=[], value=Nothing} $ KV fkey v1'

  return (second:rest, (prefix, partialNode):partials)

  where
    shouldCreate :: ([KV], [(ByteString, PartialNode)]) -> Bool
    shouldCreate (_, []) = True
    shouldCreate (_, ((partialPrefix, _):_)) =
      let inPrefixLength = BC.length $ fst $ splitPrefix k1 k2
          partialPrefixLength = BC.length $ fst $ splitPrefix k1 partialPrefix
      in inPrefixLength > partialPrefixLength

--Add to Partial Node
processNext ((KV k1 v1:rest), ((partialPrefix, thePartialNode):partialRest)) |
  partialPrefix `BC.isPrefixOf` k1 = do

  modifiedPartialNode <- addToPartial thePartialNode (KV (BC.drop (BC.length partialPrefix) k1) v1)
  return (rest, (partialPrefix, modifiedPartialNode):partialRest)
    

--Flush Partial Node
processNext (input, ((prefix, partialNode):partialrest)) = do
  let node = partialToNode partialNode

  nodePtr <- nodeData2NodeRef node
  
  when debug $
    liftIO $ putStrLn $ "#### Flush Partial(" ++ show (pretty nodePtr) ++ "):\n" ++ show (pretty node)
    
  return ((KV prefix (Left nodePtr)):input, partialrest)

processNext ([KV key val], []) = do

  let node =
        case val of
          Right tempStr -> MP.ShortcutNodeData (N.pack $ map c2n $ BC.unpack key) $ Right tempStr
          Left x -> MP.ShortcutNodeData (N.pack $ map c2n $ BC.unpack key) $ Left x

  _ <- nodeData2NodeRef node

  when debug $ do
    nodePtr <- nodeData2NodeRef node
    liftIO $ putStrLn $ "#### Output Final node(" ++ show (pretty nodePtr) ++ "):\n" ++ show (pretty node)

  return ([], [])

processNext ([], []) = error "we don't yet handle the empty trie"

processNext ((_:_:_), []) = error "it should be impossible to arrive here"



--------------------




nodeData2NodeRef :: MonadIO m => MP.NodeData->ConduitM () LevelKV m MP.NodeRef
nodeData2NodeRef nodeData =
  case rlpSerialize $ rlpEncode nodeData of
    bytes | BC.length bytes < 32 -> return $ MP.SmallRef bytes
    _     -> MP.PtrRef <$> putNodeData nodeData





putNodeData :: MonadIO m => MP.NodeData->ConduitM () LevelKV m MP.StateRoot
putNodeData nd = do
  let bytes = rlpSerialize $ rlpEncode nd
      ptr = keccak256 bytes
      levelKV = LevelKV ptr bytes
  when debug $
    liftIO $ putStrLn $ ">>>> " ++ formatLevelKV levelKV
  yield levelKV
  return $ MP.StateRoot ptr


--------------------



addToPartial :: MonadIO m => PartialNode -> KV -> ConduitM () LevelKV m PartialNode
addToPartial partialNode (KV x (Right val)) | BC.null x =
  return $ partialNode{value = Just val}
addToPartial partialNode (KV x (Left nodePtr)) | BC.length x == 1 = do
  return $ partialNode{branches = (c2n $ BC.head x, nodePtr):branches partialNode}
addToPartial partialNode (KV x val) | BC.length x >= 1 = do
  let node = MP.ShortcutNodeData (N.pack $ map c2n $ BC.unpack $ BC.tail x) val
  nodePtr <- nodeData2NodeRef node
  when debug $
    liftIO $ putStrLn $ "####addToPartial (" ++ show (pretty nodePtr) ++ "):\n" ++ show (pretty node)

  
  return $ partialNode{branches = (c2n $ BC.head x, nodePtr):branches partialNode}
addToPartial _ (KV x (Left _)) | BC.null x =
  error "addToPartial should never be called with a NodePtrValue for the default value"

addToPartial x y = error $ "It should be impossible to get to the default case of addToPartial, but somehow it happened with: " ++ show x ++ ", " ++ show y

{-
splitPrefix :: String->String->(String, (String, String))
splitPrefix (x1:xrest) (y1:yrest) | x1 == y1 =
          let (pre, suf) = splitPrefix xrest yrest
          in (x1:pre, suf)
splitPrefix x y = ("", (x, y))
-}

splitPrefix :: ByteString->ByteString->(ByteString, (ByteString, ByteString))
splitPrefix first second =
  let prefixLength = length $ takeWhile (==True) $ BC.zipWith (==) first second
  in (BC.take prefixLength first, (BC.drop prefixLength first, BC.drop prefixLength second))

{-
formatState :: ([KV], [(String, PartialNode)]) -> String
formatState (kvs, partials) = unlines $
  ["/--------------------\\"] ++
  (map ("  " ++) $ map formatKV kvs) ++
  [""] ++
  [show partials] ++
  ["\\--------------------/"]
-}

