module SolidVM.Quotation.Execution (quoteAction, helperDeclarations) where
import Language.Haskell.TH (Q, Exp)
import SolidVM.Quotation (execute, helperDeclarations)
quoteAction :: Q Exp -> Q Exp
quoteAction = execute
