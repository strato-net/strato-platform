
module BlockApps.XabiHelper
  ( hideFucn, hideFucn2 ) where

import SolidVM.Solidity.Xabi
import SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.File
import           SolidVM.Solidity.Parse.ParserTypes hiding (SolidityValue)
import           Text.Parsec                          hiding (parse)

import qualified Data.Map as M
import qualified Data.Text as T


--An Expeirment by Garrett
hideFucn :: SourceName -> SourceCode ->   [(T.Text, Xabi)]
hideFucn x y = do
  File parsedFile <- case runParser solidityFile (ParserState "" "" M.empty) x y of Left _ -> []; Right xx-> [xx];

  --parsedFile1 <- --either (die . show) return $ runParser solidityFile (ParserState "" "" M.empty) x y
  --parsedFile <- hlepr
  [(name, xabi) |  NamedXabi name (xabi, _) <- parsedFile]
  --[(name, xabi) |  NamedXabi name (xabi, parents') <- parsedFile]

hideFucn2 ::  SourceName -> SourceCode -> (SolidVM.Solidity.Parse.ParserTypes.SolcVersion,  [(T.Text, Xabi)] )
hideFucn2 x  y= (ZeroPointFour, (hideFucn x y))