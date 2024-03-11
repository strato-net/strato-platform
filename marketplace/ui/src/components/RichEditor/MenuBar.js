import React, { useState } from "react";
import { Dropdown } from "antd";
import { DownOutlined } from "@ant-design/icons";
import "./index.css";

const MenuBar = ({ editor, addLink }) => {
  const [selectedFontSize, setSelectedFontSize] = useState("12px");
  const [selectedFontFamily, setSelectedFontFamily] = useState("Arial");

  if (!editor) {
    return;
  }

  editor.on("selectionUpdate", ({ editor }) => {
    const attrs = editor.getAttributes("textStyle");

    setSelectedFontSize(attrs.fontSize || "");
    setSelectedFontFamily(
      attrs.fontFamily ? attrs.fontFamily.split(",")[0] : ""
    );
  });

  const fontSizes = [
    "12px",
    "14px",
    "16px",
    "18px",
    "20px",
    "24px",
    "28px",
    "32px",
    "36px",
  ];

  const handleFontSizeClick = (key) => {
    const fontSize = fontSizes[key];
    editor.chain().focus().setFontSize(fontSize).run();
    setSelectedFontSize(fontSize);
  };

  const fontSizeMenuItems = fontSizes.map((size, index) => ({
    key: index.toString(),
    label: size,
  }));

  const fontFamilies = [
    "Arial, sans-serif",
    "Georgia, serif",
    "Impact, sans-serif",
    "Tahoma, sans-serif",
    "Times New Roman, serif",
    "Verdana, sans-serif",
  ];

  const handleFontFamilyClick = (key) => {
    const fontFamily = fontFamilies[key];
    editor.chain().focus().setFontFamily(fontFamily).run();
    setSelectedFontFamily(fontFamily);
  };

  const fontFamilyMenuItems = fontFamilies.map((family, index) => ({
    key: index.toString(),
    label: family,
  }));

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

      <Dropdown
          className="ant-dropdown-link"
          menu={{
            items: fontSizeMenuItems,
            onClick: ({ key }) => handleFontSizeClick(key),
          }}
          trigger={["click"]}
        >
          <button onClick={(e) => e.preventDefault()}>
            {selectedFontSize || "12px"} <DownOutlined />
          </button>
        </Dropdown>

        <Dropdown
          className="ant-dropdown-link"
          menu={{
            items: fontFamilyMenuItems,
            onClick: ({ key }) => handleFontFamilyClick(key),
          }}
          trigger={["click"]}
        >
          <button onClick={(e) => e.preventDefault()}>
            {selectedFontFamily ? selectedFontFamily.split(",")[0] : "Arial"}{" "}
            <DownOutlined />
          </button>
        </Dropdown>

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

      {/* Custom color picker */}
      <button>
        <input
          type="color"
          onInput={event => editor.chain().focus().setColor(event.target.value).run()}
          value={editor.getAttributes('textStyle').color}
          data-testid="setColor"
        />
      </button>
    </>
  );
};

export default MenuBar;
