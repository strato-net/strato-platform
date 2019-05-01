module SolidVM.Solidity.Xabi.Statement where

import Control.DeepSeq
import Data.Binary
import qualified Data.Text as T
import GHC.Generics
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
  deriving (Show, Read, Eq, Generic, NFData, Binary)

data Location = Memory | Storage deriving (Show, Read, Eq, Generic, NFData, Binary)

data SimpleStatement =
  VariableDefinition (Maybe Type) (Maybe Location) [Maybe String] (Maybe Expression) -- Nothing type indicates "var" keyword
  | ExpressionStatement Expression deriving (Show, Read, Eq, Generic, NFData, Binary)

-- Currently, the only supported inline assembly is:
-- assembly {
--  result := mload(add(source, 32))
-- }
-- Anything else is a parse error.
data InlineAssembly = MloadAdd32 T.Text T.Text deriving (Show, Read, Eq, Generic, NFData, Binary)





data Expression =
  PlusPlus Expression
  | MinusMinus Expression
  | NewExpression Type
  | IndexAccess Expression (Maybe Expression)
  | MemberAccess Expression String -- ie- "x.y"
  | FunctionCall Expression ArgList
  | Unitary String Expression
  | Binary String Expression Expression
  | Ternary Expression Expression Expression
  | BoolLiteral Bool
  | NumberLiteral Integer (Maybe NumberUnit)
  | StringLiteral String
  | TupleExpression [Maybe Expression]
  | ArrayExpression [Expression]
  | Variable String deriving (Show, Read, Eq, Generic, NFData, Binary)

data ArgList = OrderedArgs [Expression] | NamedArgs [(String, Expression)] deriving (Show, Read, Eq, Generic, NFData, Binary)

data NumberUnit = Wei | Szabo | Finney | Ether deriving (Show, Read, Eq, Generic, NFData, Binary)
