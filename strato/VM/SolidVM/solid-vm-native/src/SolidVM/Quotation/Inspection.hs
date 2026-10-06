module SolidVM.Quotation.Inspection (quoteAction, quoteIntegerSize, quoteIntegerAction, quoteBlockAction, helperDeclarations) where
import Language.Haskell.TH (Q, Exp)
import SolidVM.Quotation (inspect, helperDeclarations, integerSize, integerAction, blockAction)
quoteAction :: Q Exp -> Q Exp
quoteAction = inspect

quoteIntegerSize :: String -> Q Exp
quoteIntegerSize op = inspect (integerSize op)
quoteIntegerAction :: String -> Q Exp -> Q Exp
quoteIntegerAction op quotation = inspect (integerAction op quotation)

quoteBlockAction :: Q Exp -> Q Exp
quoteBlockAction quotation = inspect (blockAction quotation)
