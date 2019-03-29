
--import Control.Monad
--import Control.Monad.Trans.Class
--import Control.Monad.IO.Class
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Conduit
import Data.Conduit.List (sourceList)
import qualified Database.LevelDB as LDB

import LevelDBTools

main :: IO ()
main = do
  c <- fmap (map BC.words . BC.lines) $ BC.getContents
  let input = map (\[x, y] -> (LevelKV (fst $ B16.decode x) (fst $ B16.decode y))) c




{-  
  _  <- LDB.runResourceT $ do
    ldb <- LDB.open "abcd2" LDB.defaultOptions{LDB.createIfMissing=True}
    forM input $ \(k, v) -> do
      LDB.put ldb LDB.defaultWriteOptions (fst $ B16.decode k) (fst $ B16.decode v)
--      liftIO $ putStrLn $ show (BC.length k) ++ " " ++ show (BC.length v)
--      liftIO $ putStrLn $ show (fst $ B16.decode k) ++ " " ++ show (fst $ B16.decode v)
-}

  _  <- LDB.runResourceT $ do
    runConduit $ sourceList input .| outputToLDB
    
  return ()


