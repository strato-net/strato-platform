import qualified Data.Map as M
import SolidVM.Solidity.Parse.File
import SolidVM.Solidity.Parse.ParserTypes
import Text.Parsec

main :: IO ()
main = do
  contents <- getContents
  let maybeFile = runParser solidityFile (ParserState "qq" "" [] M.empty 0) "qq" contents
  putStrLn $ show maybeFile
