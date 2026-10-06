module SolidVM.Quotation.Inspection (quoteAction, quoteIntegerSize, quoteIntegerAction, quoteIntegerPrimitive, quoteIntegerExpression, quoteIntegerSequence, quoteBlockAction, helperDeclarations) where
import Language.Haskell.TH (Q, Exp)
import SolidVM.Quotation (inspect, helperDeclarations, integerSize, integerAction, integerPrimitive, integerExpression, integerSequence, blockAction)
quoteAction :: Q Exp -> Q Exp
quoteAction = inspect

quoteIntegerSize :: String -> Q Exp
quoteIntegerSize op = inspect (integerSize op)
quoteIntegerAction :: String -> Q Exp -> Q Exp
quoteIntegerAction op quotation = inspect (integerAction op quotation)

quoteIntegerPrimitive :: String -> Q Exp
quoteIntegerPrimitive op = inspect (integerAction op (integerPrimitive op))

quoteIntegerExpression :: Q Exp -> Q Exp -> Q Exp -> Q Exp -> Q Exp
quoteIntegerExpression = integerExpression inspect

quoteIntegerSequence :: Q Exp -> Q Exp -> Q Exp -> Q Exp -> Q Exp -> Q Exp -> Q Exp
quoteIntegerSequence = integerSequence inspect

quoteBlockAction :: Q Exp -> Q Exp
quoteBlockAction quotation = inspect (blockAction quotation)
