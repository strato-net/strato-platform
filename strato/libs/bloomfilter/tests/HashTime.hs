import Control.Monad
import Data.BloomFilter.Hash
import qualified Data.ByteString.Lazy.Char8 as B
import Data.List
import System.Environment

main = do
  args <- getArgs
  forM_ args $ \f ->
    print =<< (foldl' hashSalt64 1 . B.lines) `fmap` B.readFile f
