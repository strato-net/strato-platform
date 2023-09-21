import qualified Data.ByteString.Char8 as BC
import qualified LabeledError

main :: IO ()
main = do
  theLines <- fmap BC.lines BC.getContents
  putStrLn $ unlines $ map (BC.unpack . LabeledError.b16Decode "B16Decode.hs") theLines
