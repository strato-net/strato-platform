module CheckContract (check) where

import           Text.Parsec
import           Data.Text.Parsec
​
import           SolidVM.Solidity.Parse.File
​
check :: C2Scompile Text -> IO ()
check code = do
  x <- 
  let maybeFile = runParser solidityFile "qq" "qq" x
  putStrLn $ show maybeFile