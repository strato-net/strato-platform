{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TypeOperators         #-}

import           Control.Monad
import qualified Control.Monad.Change.Alter                  as A
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Blockchain.Output
import           Control.Monad.Trans.Reader
import           Data.Binary                                 hiding (get)
import qualified Data.ByteString.Base16                      as B16
import qualified Data.ByteString.Char8                       as BC
import qualified Data.ByteString.Lazy                        as BL
import qualified Database.LevelDB                            as LDB
import qualified Database.Persist.Postgresql                 as SQL
import           Numeric
import           System.Environment


import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.Extra
import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia          as MP
import           Blockchain.Database.MerklePatricia.Internal
import           Blockchain.Database.MerklePatricia.NodeData
import           Blockchain.DB.SQLDB
import           Blockchain.EthConf
import           Blockchain.SHA
import           Blockchain.Stream.VMEvent

data DBs =
  DBs {
    stateDB :: MPDB,
    codeDB  :: LDB.DB,
    hashDB  :: LDB.DB,
    sqlDB   :: SQLDB
    }

instance MonadIO m => (MP.StateRoot `A.Alters` MP.NodeData) (ReaderT DBs m) where
  lookup _ = MP.genericLookupDB $ asks (MP.ldb . stateDB)
  insert _ = MP.genericInsertDB $ asks (MP.ldb . stateDB)
  delete _ = MP.genericDeleteDB $ asks (MP.ldb . stateDB)

instance MonadUnliftIO m => HasSQLDB (ReaderT DBs m) where
  getSQLDB = asks sqlDB

main :: IO ()
main = do
  args <- getArgs
  let offset =
        case args of
         [x] -> fromIntegral $ (read x :: Integer)
         _   -> error "Format: strato-backup <offset>"
  --putStrLn $ "backup: " ++ show offset
  Just (ChainBlock backupBlock:_) <- fetchVMEventsIO offset
  putStrLn $ "b" ++ BC.unpack (B16.encode $ rlpSerialize $ rlpEncode backupBlock)

  LDB.runResourceT $ do
    pool <- runNoLoggingT $ SQL.createPostgresqlPool connStr 20

    stateDB' <- LDB.open ".ethereumH/state" LDB.defaultOptions
    codeDB' <- LDB.open ".ethereumH/code" LDB.defaultOptions
    hashDB' <- LDB.open ".ethereumH/hash" LDB.defaultOptions
    let dbs = DBs{stateDB=MPDB{ldb=stateDB', stateRoot=undefined}, codeDB=codeDB', hashDB=hashDB', sqlDB=pool}

    _ <-
      flip runReaderT dbs $ do
        SHA genesisHash' <- getGenesisHash
        liftIO $ putStrLn $ "g" ++ showHex genesisHash' ""
        let stateRoot' = blockDataStateRoot $ blockBlockData backupBlock
        nodeData <- getNodeData $ PtrRef stateRoot'
        dumpNodeData handleAddressStateValue nodeData

        i <- LDB.iterOpen hashDB' LDB.defaultReadOptions
        LDB.iterFirst i

        valid <- LDB.iterValid i
        if valid
          then dumpAllHashes i
          else error "hash DB is empty"
    return ()


{-
    items <- unsafeGetAllKeyVals MPDB{ldb=stateDB', stateRoot=stateRoot'}

    forM_ items $ \(k, _) -> do
      let theHash = nibbleString2ByteString k
      Just theAddress <- LDB.get hashDB' LDB.defaultReadOptions theHash
      liftIO $ putStrLn $ "h" ++ BC.unpack (B16.encode theAddress)
-}


dumpAllHashes :: MonadIO m=>LDB.Iterator->m ()
dumpAllHashes i = do
  Just val <- LDB.iterValue i
  liftIO $ putStrLn $ "h" ++ BC.unpack (B16.encode val)
  LDB.iterNext i
  v <- LDB.iterValid i
  if v
    then dumpAllHashes i
    else return ()


handleAddressStateValue :: MonadIO m => RLPObject -> ReaderT DBs m ()
handleAddressStateValue (RLPString o) = do
  let addressState = rlpDecode $ rlpDeserialize o
  --liftIO $ putStrLn $ "Value: " ++ show addressState
  dumpAddressState addressState
handleAddressStateValue x =
      error $ "unexpected value in call to dumpNodeData: " ++ show x

handleWordValue :: MonadIO m => RLPObject -> ReaderT DBs m ()
handleWordValue _ = return ()

dumpAddressState :: MonadIO m => AddressState -> ReaderT DBs m ()
dumpAddressState AddressState{addressStateContractRoot=sr, addressStateCodeHash=c} = do
  when (sr /= emptyTriePtr) $ dumpNodeRef handleWordValue $ PtrRef sr
  dumpCode $
    case c of
      EVMCode c' -> c'
      SolidVMCode _ c' -> c'

dumpCode :: MonadIO m => SHA -> ReaderT DBs m ()
--dumpCode _ codeHash | codeHash == hash "" = do
--  liftIO $ putStrLn "<blank code>"
dumpCode codeHash = do
  codeDB' <- asks codeDB
  Just code <- LDB.get codeDB' LDB.defaultReadOptions (BL.toStrict $ encode $ sha2StateRoot codeHash)
  liftIO $ putStrLn $ "c" ++ BC.unpack (B16.encode code)

-------------

dumpNodeData :: MonadIO m => (RLPObject -> ReaderT DBs m ()) -> NodeData -> ReaderT DBs m ()
dumpNodeData _ nd@EmptyNodeData = do
  liftIO $ putStrLn $ BC.unpack (B16.encode $ rlpSerialize $ rlpEncode nd)
dumpNodeData handleValue nd@FullNodeData {choices=ch, nodeVal = maybeV} = do
  liftIO $ putStrLn $ "s" ++ BC.unpack (B16.encode $ rlpSerialize $ rlpEncode nd)
  forM_ ch $ dumpNodeRef handleValue
  case maybeV of
       Nothing -> return ()
       Just v  -> handleValue v
dumpNodeData handleValue nd@ShortcutNodeData {nextVal=nv} = do
  liftIO $ putStrLn $ "s" ++ BC.unpack (B16.encode $ rlpSerialize $ rlpEncode nd)
  case nv of
   Left nr -> dumpNodeRef handleValue nr
   Right v -> handleValue v


dumpNodeRef :: MonadIO m => (RLPObject -> ReaderT DBs m ()) -> NodeRef -> ReaderT DBs m ()
dumpNodeRef handleValue (PtrRef sr) = do
  nodeData <- getNodeData $ PtrRef sr
  dumpNodeData handleValue nodeData
dumpNodeRef _ (SmallRef _) = return ()
