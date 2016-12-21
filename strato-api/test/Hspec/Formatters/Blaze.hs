{-| This module provides 'blazeFormatter' that can be used with 'Test.Hspec.Runner.hspecWith'.

  Example usage:

  > import Test.Hspec.Formatters.Jenkins (xmlFormatter)
  > import Test.Hspec.Runner
  >
  > main :: IO ()
  > main = do
  >   summary <- withFile "results.xml" WriteMode $ \h -> do
  >     let c = defaultConfig
  >           { configFormatter = xmlFormatter
  >           , configHandle = h
  >           }
  >     hspecWith c spec
  >   unless (summaryFailures summary == 0) $
  >     exitFailure

  An example project is located in @example@ directory.
-}

{-# LANGUAGE OverloadedStrings #-}
module Hspec.Formatters.Blaze (blazeFormatter) where
import Data.List (intercalate)
import Test.Hspec.Formatters
import Test.Hspec.Runner (Path)
import Text.Blaze.Renderer.String (renderMarkup)
import Text.Blaze.Internal
import Text.Blaze.Html5
import Text.Blaze.Html5.Attributes hiding (title)
import Prelude hiding (head, id, div)

failure, skipped :: Markup -> Markup
failure = customParent "failure"
skipped = customParent "skipped"

message :: String -> Attribute
message v = customAttribute "message" $ stringValue v

-- type Path = ([String], String)
-- A tuple that represents the location of an example within a spec.
-- It consists of a list of group descriptions and a requirement description.

testcase' :: Path -> String -> Markup 
testcase' (xs, x) m = do
                    --div ! class_ "row" $ ""
                    div ! id "testcase" !   class_ "col-sm-6 bg-success" $ toHtml x
                    div ! id "testresult" ! class_ "col-sm-6 bg-success" $ toHtml m --toHtml (intercalate "." xs) 

testfail' :: Path -> String -> Markup 
testfail' (xs, x)  m = do
                    --div ! class_ "row" $ ""
                    div ! id "testcase" !   class_ "col-sm-6 bg-danger" $ toHtml x
                    div ! id "testresult" ! class_ "col-sm-6 bg-danger" $ toHtml m --toHtml (intercalate "." xs) 

-- page1 :: Markup
-- page1 = html $ do
--     head $ do
--         title "Introduction page."
--         link ! rel "stylesheet" ! type_ "text/css" ! href "screen.css"
--     body $ do
--         div ! id "header" $ "Syntax"
--         p "This is an example of BlazeMarkup syntax."
--         ul $ mapM_ (li . toMarkup . show) [1, 2, 3]

blazeFormatter :: String -> Formatter
blazeFormatter css = silent {
    headerFormatter = do

      writeLine $ "<html>\n<meta charset=\"UTF-8\"> " ++ (renderMarkup $ link ! rel "stylesheet" ! type_ "text/css" ! href "static/css/bootstrap.css")

  , exampleGroupStarted = \ss s -> do
      writeLine $ renderMarkup $ div ! id "group" ! class_ "bg-primary" $ toHtml s

  , exampleGroupDone = do
      writeLine $ ""

  , exampleSucceeded = \path -> do
      writeLine $ renderMarkup $ testcase' path "✔"
  , exampleFailed = \path err -> do
      writeLine $ renderMarkup $
        testfail' path (either formatException (Prelude.read . Prelude.show) err)
          --failure ! message (either formatException id err) $ ""
  , examplePending = \path mdesc -> do
      writeLine $ renderMarkup $
        testcase' path ( "-")
        -- $
  --         case mdesc of
  --           Just desc -> skipped ! message desc  $ ""
  --           Nothing -> skipped "" 
  ,footerFormatter = do writeLine "</html>"
  }
