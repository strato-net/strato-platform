import React, { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextStyle from "@tiptap/extension-text-style";
import ListItem from "@tiptap/extension-list-item";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import "./index.css";
import DOMPurify from 'dompurify';

const PreviewMode = ({ content }) => {
  function cleanContent(content) {
    const cleanContent = DOMPurify.sanitize(content);
    return cleanContent.replace(/\\"/g, '"');
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle.configure({ types: [ListItem.name] }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Underline,
      Link,
    ],
    content: cleanContent(content),
    editable: false
  });

  useEffect(() => {
    if (content && editor) {
      editor.commands.setContent(cleanContent(content), false);
    }
  }, [content, editor]);

  if (!editor) {
    return ( 
      <p>Error displaying content</p>
    )
  }


  return (
    <div className="tiptap">
      <EditorContent editor={editor} />
    </div>
  );
};

export default PreviewMode;
