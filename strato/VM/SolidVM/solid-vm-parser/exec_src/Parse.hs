
import           Text.Parsec

import           SolidVM.Solidity.Parse.File
import           SolidVM.Solidity.Parse.ParserTypes
import qualified Data.Map as M
main :: IO ()
main = do
  contents <- getContents
  let maybeFile = runParser solidityFile (ParserState "qq" "" M.empty) "qq" contents
  putStrLn $ show maybeFile
