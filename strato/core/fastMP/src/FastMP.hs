{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module FastMP where

import BlockApps.Logging
import Blockchain.Data.RLP
import Blockchain.Database.MerklePatricia ()
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import qualified Blockchain.Database.MerklePatricia.NodeData as MP
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import Control.Monad (when)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Loops
import Control.Monad.Trans.Reader
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.List
import qualified Data.NibbleString as N
import qualified Data.Text as T
import qualified Database.LevelDB as LDB
import KV
import LevelDBTools
import ReverseOrderedKVs
import Text.Colors
import Text.Format

debug :: Bool
debug = False

createMPFast :: LDB.DB -> ReverseOrderedKVs -> IO MP.StateRoot
createMPFast db rOrderedKVs = do
  nr <- runLoggingT . flip runReaderT db $ do
    nd <- createMPFast_NodeData rOrderedKVs
    MP.nodeData2NodeRef nd

  case nr of
    Right sr -> return sr
    Left v -> error $ "The whole trie is too small to fit in a level db key: " ++ show v

createMPFast_NodeData ::
  (MonadLogger m, (MP.StateRoot `A.Alters` MP.NodeData) m) =>
  ReverseOrderedKVs ->
  m MP.NodeData
createMPFast_NodeData rOrderedKVs = doit $ getTheKVs rOrderedKVs

{-
kvToStdout :: (Monad m, (MP.StateRoot `A.Alters` MP.NodeData) m) => ConduitT LevelKV Void m ()
kvToStdout = do
  input <- await
  case input of
    Just (LevelKV k v) -> do
      liftIO $ putStrLn $ BC.unpack (B16.encode k) ++ " " ++ BC.unpack (B16.encode v)
      kvToStdout
    Nothing -> return ()
-}

doit ::
  (MonadLogger m, (MP.StateRoot `A.Alters` MP.NodeData) m) =>
  [KV] ->
  m MP.NodeData
doit kvs = getFinalPartialNode <$> iterateUntilM inputIsExhausted processNext (kvs, [])
  where
    inputIsExhausted :: ([KV], [([N.Nibble], PartialNode)]) -> Bool
    inputIsExhausted ([], [([], _)]) = True
    inputIsExhausted ([_], []) = True
    inputIsExhausted ([], []) = True
    inputIsExhausted _ = False

    getFinalPartialNode ([], [(_, finalPartialNode)]) = partialToNode finalPartialNode
    getFinalPartialNode ([KV k v], []) = MP.ShortcutNodeData (N.pack k) v
    getFinalPartialNode ([], []) = MP.EmptyNodeData
    getFinalPartialNode _ = error "internal error: getFinalStateroot was called on a non-final state"

data NodePtr = NodePtr String deriving (Show)

data PartialNode = PartialNode
  { branches :: [(N.Nibble, MP.NodeRef)],
    value :: Maybe RLPObject
  }
  deriving (Show)

partialToNode :: PartialNode -> MP.NodeData
partialToNode (PartialNode b v) =
  MP.FullNodeData (spreadOut b [0 .. 15]) v
  where
    spreadOut :: [(N.Nibble, MP.NodeRef)] -> [N.Nibble] -> [MP.NodeRef]
    spreadOut ((k, val) : rest) (k2 : rest2) | k == k2 = val : spreadOut rest rest2
    spreadOut input (_ : rest2) = MP.emptyRef : spreadOut input rest2
    spreadOut [] [] = []
    spreadOut _ [] = error "internal error: spreadOut was given input out of order or out of range"

processNext ::
  (MonadLogger m, (MP.StateRoot `A.Alters` MP.NodeData) m) =>
  ([KV], [([N.Nibble], PartialNode)]) ->
  m ([KV], [([N.Nibble], PartialNode)])
--Create new Partial Node
processNext x@((KV k1 v1 : second@(KV k2 _) : rest), partials) | shouldCreate x = do
  let v1' =
        case v1 of
          Right tempStr -> Right tempStr
          Left val -> Left val

  let (prefix, (fkey, _)) = splitPrefix k1 k2

  partialNode <- addToPartial PartialNode {branches = [], value = Nothing} $ KV fkey v1'

  return (second : rest, (prefix, partialNode) : partials)
  where
    shouldCreate :: ([KV], [([N.Nibble], PartialNode)]) -> Bool
    shouldCreate (_, []) = True
    shouldCreate (_, ((partialPrefix, _) : _)) =
      let inPrefixLength = length $ fst $ splitPrefix k1 k2
          partialPrefixLength = length $ fst $ splitPrefix k1 partialPrefix
       in inPrefixLength > partialPrefixLength

--Add to Partial Node
processNext ((KV k1 v1 : rest), ((partialPrefix, thePartialNode) : partialRest))
  | partialPrefix `isPrefixOf` k1 = do
    modifiedPartialNode <- addToPartial thePartialNode (KV (drop (length partialPrefix) k1) v1)
    return (rest, (partialPrefix, modifiedPartialNode) : partialRest)

--Flush Partial Node
processNext (input, ((prefix, partialNode) : partialrest)) = do
  let node = partialToNode partialNode

  nodePtr <- nodeData2NodeRef node

  when debug $
    $logDebugS "processNext" . T.pack $
      concat
        [ "#### Flush Partial(",
          green (either (BC.unpack . B16.encode) format nodePtr),
          "):\n",
          format node
        ]

  return ((KV prefix (Left nodePtr)) : input, partialrest)
processNext _ = error "it should be impossible to arrive here"

--------------------

nodeData2NodeRef ::
  (MonadLogger m, (MP.StateRoot `A.Alters` MP.NodeData) m) =>
  MP.NodeData ->
  m MP.NodeRef
nodeData2NodeRef nodeData =
  case rlpSerialize $ rlpEncode nodeData of
    bytes | BC.length bytes < 32 -> return $ MP.smallRef bytes
    _ -> MP.ptrRef <$> putNodeData nodeData

putNodeData ::
  (MonadLogger m, (MP.StateRoot `A.Alters` MP.NodeData) m) =>
  MP.NodeData ->
  m MP.StateRoot
putNodeData nd = do
  let bytes = rlpSerialize $ rlpEncode nd
      ptr = keccak256ToByteString $ hash bytes
      sr = MP.StateRoot ptr
  when debug $
    $logDebugS "putNodeData" . T.pack $
      ">>>> " ++ formatLevelKV (LevelKV ptr bytes)
  A.insert A.Proxy sr nd
  return sr

--------------------

addToPartial ::
  (MonadLogger m, (MP.StateRoot `A.Alters` MP.NodeData) m) =>
  PartialNode ->
  KV ->
  m PartialNode
addToPartial partialNode (KV [] (Right val)) =
  return $ partialNode {value = Just val}
addToPartial partialNode (KV [x] (Left nodePtr)) = do
  return $ partialNode {branches = (x, nodePtr) : branches partialNode}
addToPartial partialNode (KV x@(_ : rest) val) = do
  let node = MP.ShortcutNodeData (N.pack rest) val
  nodePtr <- nodeData2NodeRef node
  when debug $
    $logDebugS "addToPartial" . T.pack $
      concat
        [ "####addToPartial (",
          green (either (BC.unpack . B16.encode) format nodePtr),
          "):\n",
          format node
        ]

  return $ partialNode {branches = (head x, nodePtr) : branches partialNode}
addToPartial _ (KV [] (Left _)) =
  error "addToPartial should never be called with a NodePtrValue for the default value"

--addToPartial x y = error $ "It should be impossible to get to the default case of addToPartial, but somehow it happened with: " ++ show x ++ ", " ++ show y

{-
splitPrefix :: String->String->(String, (String, String))
splitPrefix (x1:xrest) (y1:yrest) | x1 == y1 =
          let (pre, suf) = splitPrefix xrest yrest
          in (x1:pre, suf)
splitPrefix x y = ("", (x, y))
-}

splitPrefix :: [N.Nibble] -> [N.Nibble] -> ([N.Nibble], ([N.Nibble], [N.Nibble]))
splitPrefix first second =
  let prefixLength = length $ takeWhile (== True) $ zipWith (==) first second
   in (take prefixLength first, (drop prefixLength first, drop prefixLength second))

{-
formatState :: ([KV], [(String, PartialNode)]) -> String
formatState (kvs, partials) = unlines $
  ["/--------------------\\"] ++
  (map ("  " ++) $ map formatKV kvs) ++
  [""] ++
  [show partials] ++
  ["\\--------------------/"]
-}
