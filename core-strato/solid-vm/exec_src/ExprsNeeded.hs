{-# LANGUAGE LambdaCase #-}
import Control.Exception (throw)
import qualified Data.Map as M
import qualified Data.Text as T
import System.Environment
import System.Exit
import Text.Parsec (runParser)
import Text.Printf

import CodeCollection
import SolidVM.Solidity.Parse.Declarations
import SolidVM.Solidity.Parse.File

main :: IO ()
main = do
  argv <- getArgs
  progName <- getProgName
  filename <- case argv of
    [] -> die $ printf "usage: %s <filename>" progName
    (fn:_) -> return fn
  contents <- readFile filename
  File parsedFile <- either (die . show) return
              $ runParser solidityFile "" "" contents
  let pragmas = \case
        Pragma _ n v -> Just (n, v)
        _ -> Nothing
  let vmVersion' = if (Just ("solidvm","3.0")) `elem` (pragmas <$> parsedFile) then "svm3.0" else ""
      namedContracts = [(T.unpack name, either (throw . fst) id $ xabiToContract (T.unpack name) (map T.unpack parents') vmVersion' xabi)
                       | NamedXabi name (xabi, parents') <- parsedFile]
      cc = CodeCollection $ M.fromList namedContracts
      nodes = codeCollectionCrawler cc
  mapM_ (putStrLn . T.unpack) nodes
