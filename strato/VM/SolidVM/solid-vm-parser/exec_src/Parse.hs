import SolidVM.Solidity.Parse.File
import SolidVM.Solidity.Parse.ParserTypes
import Text.Parsec

main :: IO ()
main = do
  contents <- getContents
  let maybeFile = runParser solidityFile initialParserState {contractName = "qq"} "qq" contents
  putStrLn $ show maybeFile
