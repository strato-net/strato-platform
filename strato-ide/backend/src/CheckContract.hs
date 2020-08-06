{-# LANGUAGE DataKinds #-}

module CheckContract (check) where

import           Text.Parsec
import           Data.Text

import Common.Message

check :: C2S -> Text
check code = pack "\
\Line 180: error: cannot find symbol [in MyLinkedList.java]\
            \iter = iter.next;\
            \^\
  \symbol:   variable iter\
  \location: class MyLinkedList\
\Line 180: error: cannot find symbol [in MyLinkedList.java]\
            \iter = iter.next;\
                   \^\
  \symbol:   variable iter\
  \location: class MyLinkedList\
\Line 183: error: cannot find symbol [in MyLinkedList.java]\
        \Node bore = iter.prev;\
                    \^\
  \symbol:   variable iter\
  \location: class MyLinkedList\
\Line 185: error: cannot find symbol [in MyLinkedList.java]\
        \Ne after = iter.next;\
        \^\
  \symbol:   class Ne\
  \location: class MyLinkedList\
\Line 185: error: cannot find symbol [in MyLinkedList.java]\
        \Ne after = iter.next;\
                   \^\
  \symbol:   variable iter\
  \location: class MyLinkedList\
\Line 187: error: cannot find symbol [in MyLinkedList.java]\
        \before.next = after;\
        \^\
  \symbol:   variable before\
  \location: class MyLinkedList\
\Line 189: error: cannot find symbol [in MyLinkedList.java]\
        \after.prev = before;\
                     \^\
  \symbol:   variable before\
  \location: class MyLinkedList\
\7 errors" :: Text