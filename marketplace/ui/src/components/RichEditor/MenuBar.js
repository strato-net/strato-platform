import React from "react";
import "./index.css";

const MenuBar = ({ editor, addLink }) => {
  if (!editor) {
    return;
  }

  return (
    <>
      {/* Bold */}
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={!editor.can().chain().focus().toggleBold().run()}
        className={editor.isActive("bold") ? "is-active" : ""}
      >
        Bold
      </button>

      {/* Italic */}
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={!editor.can().chain().focus().toggleItalic().run()}
        className={editor.isActive("italic") ? "is-active" : ""}
      >
        Italic
      </button>

      {/* Underline Button */}
      <button
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={editor.isActive("underline") ? "is-active" : ""}
      >
        Underline
      </button>
      {/* Strike */}
      <button
        onClick={() => editor.chain().focus().toggleStrike().run()}
        disabled={!editor.can().chain().focus().toggleStrike().run()}
        className={editor.isActive("strike") ? "is-active" : ""}
      >
        Strike
      </button>

      {/* Text Alignment */}
      <button
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
        className={editor.isActive({ textAlign: "left" }) ? "is-active" : ""}
      >
        Left
      </button>
      <button
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
        className={editor.isActive({ textAlign: "center" }) ? "is-active" : ""}
      >
        Center
      </button>
      <button
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
        className={editor.isActive({ textAlign: "right" }) ? "is-active" : ""}
      >
        Right
      </button>

      {/* Bullet List */}
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={editor.isActive("bulletList") ? "is-active" : ""}
      >
        Bullet List
      </button>

      {/* Ordered List */}
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={editor.isActive("orderedList") ? "is-active" : ""}
      >
        Ordered List
      </button>

      {/* Blockquote */}
      <button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={editor.isActive("blockquote") ? "is-active" : ""}
      >
        Blockquote
      </button>

      {/* Button for inserting links */}
      <button onClick={addLink}>Insert Link</button>

      {/* Horizontal Rule */}
      <button onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        Divider
      </button>

      {/* Hard Break */}
      <button onClick={() => editor.chain().focus().setHardBreak().run()}>
        New Line
      </button>

      {/* Undo */}
      <button
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().chain().focus().undo().run()}
      >
        Undo
      </button>

      {/* Redo */}
      <button
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().chain().focus().redo().run()}
      >
        Redo
      </button>
      {/* Clear Marks */}
      <button onClick={() => editor.chain().focus().unsetAllMarks().run()}>
        Clear Marks
      </button>

      {/* Clear Nodes */}
      <button onClick={() => editor.chain().focus().clearNodes().run()}>
        Clear Formatting
      </button>
    </>
  );
};

export default MenuBar;
