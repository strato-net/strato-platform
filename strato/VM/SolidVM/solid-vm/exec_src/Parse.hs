
import           Text.Parsec

import           SolidVM.Solidity.Parse.File

main :: IO ()
main = do
  contents <- getContents
  let maybeFile = runParser solidityFile "qq" "qq" contents
  putStrLn $ show maybeFile
