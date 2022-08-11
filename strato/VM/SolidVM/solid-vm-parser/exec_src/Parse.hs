
import           Text.Parsec

import           SolidVM.Solidity.Parse.File
import           SolidVM.Solidity.Parse.ParserTypes

main :: IO ()
main = do
  contents <- getContents
  let maybeFile = runParser solidityFile (ParserState "qq" "") "qq" contents
  putStrLn $ show maybeFile
