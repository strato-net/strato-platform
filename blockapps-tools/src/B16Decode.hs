
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Base16 as B16

main::IO ()
main = do
  theLines <- fmap BC.lines BC.getContents
  putStrLn $ unlines $ map (BC.unpack . fst . B16.decode) theLines
