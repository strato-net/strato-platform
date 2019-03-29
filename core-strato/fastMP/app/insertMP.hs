
--import Control.Monad.IO.Class
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.NibbleString as N
import qualified Database.LevelDB as LDB

import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import Text.Format

import KV

insertKV :: LDB.MonadResource m => MP.MPDB -> KV -> m MP.MPDB
insertKV mpdb (KV key (Right val)) = do
  --liftIO $ putStrLn $ "key=" ++ show (N.pack $ map c2n key) ++ ", val=" ++ show val
  MP.unsafePutKeyVal mpdb (N.pack $ map c2n $ BC.unpack key) val
insertKV _ (KV _ val) = error $ "insertKV called with val = " ++ show val

insertKVs :: LDB.MonadResource m => MP.MPDB -> [KV] -> m MP.MPDB
insertKVs mpdb [] = return mpdb
insertKVs mpdb (x:rest) = do
  mpdb' <- insertKV mpdb x
  insertKVs mpdb' rest


main :: IO ()
main = do
  c <- fmap (map BC.words . BC.lines) $ BC.getContents
  let input = map (\[x, y] -> KV x $ Right (RLPString . fst . B16.decode $ y)) c

  mpdb'  <- LDB.runResourceT $ do
    ldb <- LDB.open "abcd" LDB.defaultOptions{LDB.createIfMissing=True}
    let mpdb = MP.MPDB{MP.ldb=ldb, MP.stateRoot=MP.blankStateRoot}
    MP.initializeBlank mpdb
    insertKVs mpdb input
    
  putStrLn $ "new StateRoot: " ++ format (MP.stateRoot mpdb')
