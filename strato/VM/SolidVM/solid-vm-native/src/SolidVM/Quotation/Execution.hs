module SolidVM.Quotation.Execution (quoteAction, quoteIntegerSize, quoteIntegerAction, quoteIntegerPrimitive, quoteIntegerExpression, quoteIntegerSequence, quoteBlockAction, helperDeclarations) where
import Language.Haskell.TH (Q, Exp)
import SolidVM.Quotation (execute, helperDeclarations, integerSize, integerAction, integerPrimitive, integerExpression, integerSequence, blockAction)
quoteAction :: Q Exp -> Q Exp
quoteAction = execute

quoteIntegerSize :: String -> Q Exp
quoteIntegerSize op = execute (integerSize op)
quoteIntegerAction :: String -> Q Exp -> Q Exp
quoteIntegerAction op quotation = execute (integerAction op quotation)

quoteIntegerPrimitive :: String -> Q Exp
quoteIntegerPrimitive op = execute (integerAction op (integerPrimitive op))

quoteIntegerExpression :: Q Exp -> Q Exp -> Q Exp -> Q Exp -> Q Exp
quoteIntegerExpression = integerExpression execute

quoteIntegerSequence :: Q Exp -> Q Exp -> Q Exp -> Q Exp -> Q Exp -> Q Exp -> Q Exp
quoteIntegerSequence = integerSequence execute

quoteBlockAction :: Q Exp -> Q Exp
quoteBlockAction quotation = execute (blockAction quotation)
