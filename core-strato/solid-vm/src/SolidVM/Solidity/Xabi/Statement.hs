
module SolidVM.Solidity.Xabi.Statement where
import qualified Data.Text as T
import SolidVM.Solidity.Xabi.Type

data Statement =
  IfStatement Expression [Statement] (Maybe [Statement]) -- if then else
  | WhileStatement Expression [Statement]
  | ForStatement (Maybe SimpleStatement) (Maybe Expression) (Maybe Expression) [Statement]
  | Block
  | DoWhileStatement Statement Expression
  | Continue
  | Break
  | Return (Maybe Expression)
  | Throw
  | EmitStatement String [(Maybe String, Expression)]
  | AssemblyStatement InlineAssembly
  | SimpleStatement SimpleStatement
  deriving (Show, Eq)

data SimpleStatement =
  VariableDefinition (Maybe Type) [Maybe String] (Maybe Expression) -- Nothing type indicates "var" keyword
  | ExpressionStatement Expression deriving (Show, Eq)

-- Currently, the only supported inline assembly is:
-- assembly {
--  result := mload(add(source, 32))
-- }
-- Anything else is a parse error.
data InlineAssembly = MloadAdd32 T.Text T.Text deriving (Show, Eq)





data Expression =
  PlusPlus Expression
  | MinusMinus Expression
  | NewExpression Type
  | IndexAccess Expression (Maybe Expression)
  | MemberAccess Expression String -- ie- "x.y"
  | FunctionCall Expression [(Maybe String, Expression)]
  | Unitary String Expression
  | Binary String Expression Expression
  | Ternary Expression Expression Expression
  | BoolLiteral Bool
  | NumberLiteral Integer (Maybe NumberUnit)
  | StringLiteral String
  | TupleExpression [Expression]
  | Variable String deriving (Show, Eq)


data NumberUnit = Wei | Szabo | Finney | Ether deriving (Show, Eq)
