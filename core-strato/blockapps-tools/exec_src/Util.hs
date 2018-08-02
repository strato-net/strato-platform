module Util where

import           Control.Monad.IO.Class
import           Control.Monad.Loops
import           Control.Monad.Trans.Resource
import qualified Data.ByteString              as B
import           Data.Default
import qualified Database.LevelDB             as DB

ldbForEach :: FilePath -> (B.ByteString -> B.ByteString -> IO ()) -> IO ()
ldbForEach dbDir f = runResourceT $ do
    db <- DB.open dbDir def
    i <- DB.iterOpen db def
    DB.iterFirst i
    whileM_ (DB.iterValid i) $ do
      Just key <- DB.iterKey i
      Just val <- DB.iterValue i
      liftIO $ f key val
      DB.iterNext i
      return ()

tab :: String->String
tab []          = []
tab ('\n':rest) = "\n  " ++ tab rest
tab (c:rest)    = c:tab rest
