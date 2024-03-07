import React, { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextStyle from "@tiptap/extension-text-style";
import ListItem from "@tiptap/extension-list-item";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import "./index.css";

const PreviewMode = ({ content }) => {
  // TODO: We need to snaitize the HTML before displaying in the UI.
  // Currently all "s become \" which is throwing off the styling and the display of text.
  // Depending on the sanitization library we may not need to use this component.
  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle.configure({ types: [ListItem.name] }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Underline,
      Link,
    ],
    content: content,
    editable: false
  });

  useEffect(() => {
    if (content && editor) {
      editor.commands.setContent(content, false);
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
