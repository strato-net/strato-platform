module SolidVM.Quotation.Inspection (quoteAction, helperDeclarations) where
import Language.Haskell.TH (Q, Exp)
import SolidVM.Quotation (inspect, helperDeclarations)
quoteAction :: Q Exp -> Q Exp
quoteAction = inspect
