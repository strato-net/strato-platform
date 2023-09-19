{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}

--import Control.Monad.IO.Class

import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import Control.Monad.Change.Alter
import Control.Monad.Trans.Reader
import qualified Data.ByteString.Char8 as BC
import qualified Data.NibbleString as N
import qualified Database.LevelDB as LDB
import FastMP ()
import KV
import qualified LabeledError
import Text.Format

insertKV ::
  (MP.StateRoot `Alters` MP.NodeData) m =>
  MP.StateRoot ->
  KV ->
  m MP.StateRoot
insertKV sr (KV key (Right val)) = do
  --liftIO $ putStrLn $ "key=" ++ show (N.pack $ map c2n key) ++ ", val=" ++ show val
  MP.unsafePutKeyVal sr (N.pack key) val
insertKV _ (KV _ val) = error $ "insertKV called with val = " ++ show val

insertKVs ::
  (MP.StateRoot `Alters` MP.NodeData) m =>
  MP.StateRoot ->
  [KV] ->
  m MP.StateRoot
insertKVs sr [] = return sr
insertKVs sr (x : rest) = do
  sr' <- insertKV sr x
  insertKVs sr' rest

main :: IO ()
main = do
  c <- fmap (map BC.words . BC.lines) $ BC.getContents
  -- let input = map (\[x, y] -> KV (map c2n $ BC.unpack x) $ Right (RLPString . LabeledError.b16Decode "insertMP.hs" $ y)) c
  let input =
        map
          ( \lst ->
              if length lst < 2
                then error "input list should contain exactly 2 elements"
                else KV (map c2n $ BC.unpack (head lst)) $ Right (RLPString . LabeledError.b16Decode "insertMP.hs" $ (lst !! 1))
          )
          c

  sr' <- LDB.runResourceT $ do
    ldb <- LDB.open "abcd" LDB.defaultOptions {LDB.createIfMissing = True}
    flip runReaderT ldb $ do
      MP.initializeBlank
      insertKVs MP.blankStateRoot input

  putStrLn $ "new StateRoot: " ++ format sr'
