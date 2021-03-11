{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
module SolidVM.Solidity.Xabi.Statement
  ( StatementF(..)
  , Statement
  , Location(..)
  , VarDefEntry(..)
  , vardefLocation
  , SimpleStatement(..)
  , InlineAssembly(..)
  , Expression(..)
  , ArgList(..)
  , NumberUnit(..)
  , module Text.Parsec.Pos
  ) where

import qualified Data.Text as T
import GHC.Generics
import SolidVM.Solidity.Xabi.Type
import Text.Parsec.Pos

data StatementF a =
  IfStatement Expression [StatementF a] (Maybe [StatementF a]) a -- if then else
  | WhileStatement Expression [StatementF a] a
  | ForStatement (Maybe SimpleStatement) (Maybe Expression) (Maybe Expression) [StatementF a] a
  | Block a
  | DoWhileStatement [StatementF a] Expression a
  | Continue a
  | Break a
  | Return (Maybe Expression) a
  | Throw a
  | EmitStatement String [(Maybe String, Expression)] a
  | AssemblyStatement InlineAssembly a
  | SimpleStatement SimpleStatement a
  deriving (Show, Eq, Generic)

type Statement = StatementF SourcePos

data Location = Memory | Storage deriving (Show, Eq, Generic)

data VarDefEntry = BlankEntry
                 | VarDefEntry { vardefType :: Maybe Type
                               , _vardefLocation :: Maybe Location
                               , vardefName :: String
                               } deriving (Show, Eq, Generic)

vardefLocation :: VarDefEntry -> Maybe Location
vardefLocation BlankEntry = Nothing
vardefLocation (VarDefEntry _ mLoc _) = mLoc

data SimpleStatement =
  VariableDefinition [VarDefEntry] (Maybe Expression) -- Nothing type indicates "var" keyword
  | ExpressionStatement Expression deriving (Show, Eq, Generic)

-- Currently, the only supported inline assembly is:
-- assembly {
--  result := mload(add(source, 32))
-- }
-- Anything else is a parse error.
data InlineAssembly = MloadAdd32 T.Text T.Text deriving (Show, Eq, Generic)



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
  | Variable String deriving (Show, Eq, Generic)

data ArgList = OrderedArgs [Expression] | NamedArgs [(String, Expression)] deriving (Show, Eq, Generic)

data NumberUnit = Wei | Szabo | Finney | Ether deriving (Show, Eq, Generic)
