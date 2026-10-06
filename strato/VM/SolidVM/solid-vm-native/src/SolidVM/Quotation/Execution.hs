module SolidVM.Quotation.Execution (quoteAction, quoteIntegerSize, quoteIntegerAction, quoteBlockAction, helperDeclarations) where
import Language.Haskell.TH (Q, Exp)
import SolidVM.Quotation (execute, helperDeclarations, integerSize, integerAction, blockAction)
quoteAction :: Q Exp -> Q Exp
quoteAction = execute

quoteIntegerSize :: String -> Q Exp
quoteIntegerSize op = execute (integerSize op)
quoteIntegerAction :: String -> Q Exp -> Q Exp
quoteIntegerAction op quotation = execute (integerAction op quotation)

quoteBlockAction :: Q Exp -> Q Exp
quoteBlockAction quotation = execute (blockAction quotation)
