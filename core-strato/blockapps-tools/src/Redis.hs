module Redis where

import Control.Monad.IO.Class
import Blockchain.EthConf
import qualified Data.ByteString as B
import Database.Redis
import Data.List (intercalate)
import Blockchain.Strato.RedisBlockDB
import Blockchain.Strato.RedisBlockDB.Models
import System.Exit
import Text.Printf

fromWrapped :: (Show e, MonadIO m) => Either e (f a) -> m (f a)
fromWrapped = liftIO . \case
  Left err -> die $ show err
  Right fv -> return fv

redis :: B.ByteString -> IO ()
redis key = do
  conn <- checkedConnect lookupRedisBlockDBConfig
  runRedis conn $ printKeyVal key

redisMatch :: B.ByteString -> IO ()
redisMatch pattern = do
  conn <- checkedConnect lookupRedisBlockDBConfig
  runRedis conn $ do
    eAllKeys <- keys pattern
    case eAllKeys of
      Left err -> liftIO . die $ show err
      Right allKeys -> mapM_ printKeyVal allKeys

printKeyVal :: B.ByteString -> Redis ()
printKeyVal key =
  let ns = findNamespace key
      display = liftIO . printf "%s %s %s\n" (show key) (show ns)
  in if ns == Numbers || ns == Children
        then do
          vals <- fromWrapped =<< smembers key
          display . intercalate "," $ map (displayForNamespace ns) vals
        else do
          val <- fromWrapped =<< get key
          display $ maybe "<nothing>" (displayForNamespace ns) val
