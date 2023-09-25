{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}

module ParserSpec where

import Control.Monad
import Data.Either (isLeft)
import Data.Source.Annotation as SA
import Data.Source.Position as SP
import SolidVM.Model.CodeCollection.Statement
import SolidVM.Model.Type
import SolidVM.Solidity.Parse.Lexer
import SolidVM.Solidity.Parse.ParserTypes
import SolidVM.Solidity.Parse.Statement
import Test.HUnit (assertEqual)
import Test.Hspec
import Text.Parsec
import Text.RawString.QQ

dummyAnnotation :: SA.SourceAnnotation ()
dummyAnnotation =
  SA.SourceAnnotation
    { SA._sourceAnnotationStart =
        SP.SourcePosition
          { SP._sourcePositionName = "",
            SP._sourcePositionLine = 0,
            SP._sourcePositionColumn = 0
          },
      SA._sourceAnnotationEnd =
        SP.SourcePosition
          { SP._sourcePositionName = "",
            SP._sourcePositionLine = 0,
            SP._sourcePositionColumn = 0
          },
      SA._sourceAnnotationAnnotation = ()
    }

spec :: Spec
spec = do
  describe "String lexing" $ do
    let parseStr = runParser (stringLiteral <* eof) initialParserState ""
        cases =
          [ ([r|"ok"|], "ok"),
            ([r|"ok" |], "ok")
          ]
    forM_ cases $ \(input, want) -> do
      it ("can parse " ++ show input) $ parseStr input `shouldBe` Right want

  describe "Expression parsing" $ do
    let parseExpr = fmap (fmap (const ())) . runParser expression initialParserState ""
        cases =
          [ ("x++", PlusPlus () (Variable () "x")),
            ("++x", Unitary () "++" (Variable () "x")),
            ("--x", Unitary () "--" (Variable () "x")),
            ("-x", Unitary () "-" (Variable () "x")),
            ("x--", MinusMinus () (Variable () "x")),
            ("x + y", Binary () "+" (Variable () "x") (Variable () "y")),
            ("x ** y", Binary () "**" (Variable () "x") (Variable () "y")),
            ("x[q]", IndexAccess () (Variable () "x") (Just $ Variable () "q")),
            ("hex'4F9A'", HexaLiteral () "4F9A"),
            ("hex\"4F9A\"", HexaLiteral () "4F9A"),
            ( "x[a][b][c]",
              IndexAccess
                ()
                ( IndexAccess
                    ()
                    ( IndexAccess
                        ()
                        (Variable () "x")
                        (Just $ Variable () "a")
                    )
                    (Just $ Variable () "b")
                )
                (Just $ Variable () "c")
            ),
            ("int(8824)", FunctionCall () (Variable () "int") $ OrderedArgs [NumberLiteral () 8824 Nothing]),
            ("int32(8824)", FunctionCall () (Variable () "int32") $ OrderedArgs [NumberLiteral () 8824 Nothing]),
            ( "int(x)[y]",
              IndexAccess () (FunctionCall () (Variable () "int") $ OrderedArgs [Variable () "x"]) $
                Just $ Variable () "y"
            ),
            ( "xs[y].z",
              MemberAccess
                ()
                (IndexAccess () (Variable () "xs") (Just $ Variable () "y"))
                "z"
            ),
            ("x.f()", FunctionCall () (MemberAccess () (Variable () "x") "f") $ OrderedArgs [])
          ]
    forM_ cases $ \(input, want) -> do
      it ("can parse " ++ input) $ parseExpr input `shouldBe` Right want

    it "can parse function calls" $ do
      let f = FunctionCall () (Variable () "f")
          true = OrderedArgs [BoolLiteral () True]
          ok = OrderedArgs [StringLiteral () "ok"]
          fcases =
            [ ("f(true)", f true),
              ("f(true\n)", f true),
              ("f(\"ok\")", f ok),
              ("f(\"ok\"\n)", f ok),
              ("f({})", f $ NamedArgs []),
              ("f({ x : y})", f $ NamedArgs [("x", Variable () "y")]),
              ("f ( { x : y , q : z } )", f $ NamedArgs [("x", Variable () "y"), ("q", Variable () "z")])
            ]
      forM_ fcases $ \(input, want) -> do
        assertEqual input (Right want) (parseExpr input)

  {-
  ------------------------------------------------------------------------------------------------------------------------------------------------
     DECLARATIONS AND CONTRACT PARSERS, These will always fail, but are super useful for testing what the contract or declaration is parsing to.
     to use, just uncomment
    --import SolidVM.Solidity.Parse.Declarations
    --import SolidVM.Model.CodeCollection.Def as Def
    at the top of the file, and then uncomment the test, and put in your desired declaration or contract and it will print out the parsed contract or declaration.

  -------------------------------------------------------------------------------------------------------------------------------------------------
  -}

  -- describe "Declaration parsing" $ do
  --   let parseDecl = runParser solidityDeclaration (ParserState "" "") ""
  --       cases = [ ("int x;", EnumDeclaration $ Def.Enum [] (fromInteger 2) dummyAnnotation)
  --               , ("string[] data = ['a', 'b', 'c'];", DummyDeclaration)
  --               -- , ("function a() public myModifier returns (bool) {\nx = 5;\nreturn true;\n}" , DummyDeclaration)
  --               -- , ("constructor() public returns (bool) {\nreturn true;\n}" , DummyDeclaration)
  --               -- , ("contract qq {\nuint x;\nmodifier myModifier() {\n require(false, 'bigTest');\n\n}\nconstructor() myModifier(3) public returns (bool) {\nx = 5;\nreturn true;\n}\n}", DummyDeclaration)
  --               -- , ("modifier myModifier() {\n require(false, 'bigTest');\n_;\n}", DummyDeclaration)
  --               -- , ("SimpleStorage myContract = new SimpleStorage();", DummyDeclaration)
  --               ]
  --   forM_ cases $ \(input, want) -> do
  --     it ("can parse " ++ input) $ parseDecl input `shouldBe` Right ((show want), want)
  {-}

  --"contract qq {\n  uint x = 3;\n  modifier myModifier(uint _x) {\n      require(_x == 3 , string.concat('x is not 3 : ', string(_x)));\n    x = 4;    _;\n    require(x == 5 , 'x is not 5');\n  }\n\n  constructor() public myModifier(3) {\n    x = 5;\n    return;\n  }\n}\n"
    describe "Contract Parsing" $ do
      let parseContract = runParser solidityContract "" ""
          cases = [ ( "contract qq {\n  uint constant c = 2022;\n  constructor() public\n {\n    c = 666;\n  }\n}", DummySourceUnit)
                  --, ("contract qq {\n  uint x;\n  modifier myModifier() {\n      require(false, 'bigTest');\n  }\n  function a() public myModifier() returns (bool) {\n    x = 5;\n    return true;\n  }\n}" , DummySourceUnit)
                  ]
      forM_ cases $ \(input, want) -> do
        it ("can parse " ++ input) $ parseContract input `shouldBe` Right want

  -}

  describe "Statement parsing" $ do
    let parseStatement = fmap (fmap (const ())) . runParser statement initialParserState ""
        scases =
          [ ("x++;", SimpleStatement $ ExpressionStatement $ PlusPlus () $ Variable () "x"),
            ( "assembly { dst := mload(add(src, 32)) }",
              AssemblyStatement $ MloadAdd32 "dst" "src"
            ),
            ( "Nom storage nom = ns[10];",
              SimpleStatement $
                VariableDefinition [VarDefEntry (Just $ UnknownLabel "Nom" Nothing) (Just Storage) "nom" ()] $
                  Just $
                    IndexAccess () (Variable () "ns") (Just $ NumberLiteral () 10 Nothing)
            ),
            ( "var (x, y) = (7, 3);",
              SimpleStatement $
                VariableDefinition
                  [ VarDefEntry Nothing Nothing "x" (),
                    VarDefEntry Nothing Nothing "y" ()
                  ]
                  $ Just $
                    TupleExpression () $ map (\n -> Just (NumberLiteral () n Nothing)) [7, 3]
            ),
            ( "(z, w) = (q, r);",
              SimpleStatement $
                ExpressionStatement $
                  Binary
                    ()
                    "="
                    (TupleExpression () $ map (Just . Variable ()) ["z", "w"])
                    (TupleExpression () $ map (Just . Variable ()) ["q", "r"])
            ),
            ( "(z, ) = (q, r);",
              SimpleStatement $
                ExpressionStatement $
                  Binary
                    ()
                    "="
                    (TupleExpression () $ [Just $ Variable () "z", Nothing])
                    (TupleExpression () $ map (Just . Variable ()) ["q", "r"])
            ),
            ("eq = ne;", SimpleStatement $ ExpressionStatement $ Binary () "=" (Variable () "eq") (Variable () "ne")),
            ( "var (a, b, , );",
              SimpleStatement $
                VariableDefinition
                  [VarDefEntry Nothing Nothing "a" (), VarDefEntry Nothing Nothing "b" (), BlankEntry, BlankEntry]
                  Nothing
            ),
            ( "var x = [7, 3];",
              SimpleStatement $
                VariableDefinition [VarDefEntry Nothing Nothing "x" ()] $
                  Just $
                    ArrayExpression () $ map (\n -> NumberLiteral () n Nothing) [7, 3]
            ),
            ( "var x = [];",
              SimpleStatement $
                VariableDefinition [VarDefEntry Nothing Nothing "x" ()] $
                  Just $
                    ArrayExpression () []
            ),
            ("revert f(x, y);", RevertStatement (Just "f") (OrderedArgs [(Variable () "x"), (Variable () "y")])),
            ("revert(\"e\");", RevertStatement (Nothing) (OrderedArgs [StringLiteral () "e"])),
            ("revert f({ x: y , q: z });", RevertStatement (Just "f") (NamedArgs [("x", Variable () "y"), ("q", Variable () "z")]))
          ]
    forM_ scases $ \(input, want) -> do
      it ("can parse " ++ input) $ parseStatement input `shouldBe` Right (want ())

    let fcases = ["assembly {}", "assembly { dst := mload(src) }", "assembly { dst := add(src, 32) }"]
    forM_ fcases $ \input -> do
      it ("cannot parse " ++ input) $ parseStatement input `shouldSatisfy` isLeft
