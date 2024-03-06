import React, { useState } from "react";
import { useEditor, EditorContent, BubbleMenu, Extension } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Color from "@tiptap/extension-color";
import TextStyle from "@tiptap/extension-text-style";
import ListItem from "@tiptap/extension-list-item";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import "./index.css";
import { Dropdown, Popconfirm, Button } from "antd";
import { DownOutlined } from "@ant-design/icons";
import {
  BoldOutlined,
  ItalicOutlined,
  StrikethroughOutlined,
  AlignLeftOutlined,
  AlignCenterOutlined,
  AlignRightOutlined,
  OrderedListOutlined,
  UnorderedListOutlined,
  LinkOutlined,
} from "@ant-design/icons";

const FontSize = Extension.create({
  name: "fontSize",

  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) {
                return {};
              }
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (fontSize) =>
        ({ chain }) => {
          return chain().setMark("textStyle", { fontSize }).run();
        },
      unsetFontSize:
        () =>
        ({ chain }) => {
          return chain()
            .setMark("textStyle", { fontSize: null })
            .removeEmptyTextStyle()
            .run();
        },
    };
  },
});

const FontFamily = Extension.create({
  name: "fontFamily",

  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (element) => element.style.fontFamily,
            renderHTML: (attributes) => {
              if (!attributes.fontFamily) {
                return {};
              }
              return { style: `font-family: ${attributes.fontFamily}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontFamily:
        (fontFamily) =>
        ({ chain }) => {
          return chain().setMark("textStyle", { fontFamily }).run();
        },
      unsetFontFamily:
        () =>
        ({ chain }) => {
          return chain()
            .setMark("textStyle", { fontFamily: null })
            .removeEmptyTextStyle()
            .run();
        },
    };
  },
});

const MenuBar = ({ editor, addLink }) => {
  const [selectedFontSize, setSelectedFontSize] = useState("12px");
  const [selectedFontFamily, setSelectedFontFamily] = useState("Arial");

  if (!editor) {
    return;
  }

  editor.on("selectionUpdate", ({ editor }) => {
    const attrs = editor.getAttributes("textStyle");

    // Set the active attributes if they are consistent across the selection
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
      <div className="toolbar-color-picker">
        <input
          type="color"
          onInput={(event) =>
            editor.chain().focus().setColor(event.target.value).run()
          }
          value={editor.getAttributes("textStyle").color || "#000000"} // Default color
          style={{
            opacity: 0,
            position: "absolute",
            zIndex: -1,
          }}
        />
        <button
          onClick={() =>
            document.querySelector(".toolbar-color-picker input").click()
          }
          className="toolbar-button"
        >
          Color
        </button>
      </div>
    </>
  );
};

const RichEditor = ({ details, user, isAuthenticated }) => {
  const isEditable = isAuthenticated && details.owner === user.userAddress;
  const [editMode, setEditMode] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Color.configure({ types: [TextStyle.name, ListItem.name] }),
      TextStyle.configure({ types: [ListItem.name] }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link,
      FontSize,
      FontFamily,
    ],
    content: details.description,
    editable: isEditable,
  });

  if (!editor) {
    return null;
  }

  const addLink = () => {
    // Prompt the user for a URL
    const url = window.prompt("Enter the URL");

    // Check if a URL was provided
    if (url) {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url })
        .run();
    }
  };

  const handleSave = () => {
    const updatedContent = editor.getHTML();
    console.log("Saved content:", updatedContent);

    setEditMode(false);
  };

  const handleCancel = () => {
    editor.commands.setContent(details.description);
    setEditMode(false);
  };

  return (
    <div className="tiptap" key={`editor-${editMode}`}>
      {isEditable && !editMode && (
        <Button
          onClick={() => setEditMode(true)}
          className="flex items-center px-4 py-5 !bg-primary !hover:bg-primaryHover !text-white"
        >
          Edit
        </Button>
      )}
      {editMode && (
        <>
          <BubbleMenu
            className="bubble-menu"
            editor={editor}
            tippyOptions={{ duration: 100 }}
          >
            {/* Bold */}
            <button
              onClick={() => editor.chain().focus().toggleBold().run()}
              disabled={!editor.can().chain().focus().toggleBold().run()}
              className={editor.isActive("bold") ? "is-active" : ""}
            >
              <BoldOutlined />
            </button>

            {/* Italic */}
            <button
              onClick={() => editor.chain().focus().toggleItalic().run()}
              disabled={!editor.can().chain().focus().toggleItalic().run()}
              className={editor.isActive("italic") ? "is-active" : ""}
            >
              <ItalicOutlined />
            </button>

            {/* Strike */}
            <button
              onClick={() => editor.chain().focus().toggleStrike().run()}
              disabled={!editor.can().chain().focus().toggleStrike().run()}
              className={editor.isActive("strike") ? "is-active" : ""}
            >
              <StrikethroughOutlined />
            </button>

            {/* Align Text */}
            <button
              onClick={() => editor.chain().focus().setTextAlign("left").run()}
            >
              <AlignLeftOutlined />
            </button>
            <button
              onClick={() =>
                editor.chain().focus().setTextAlign("center").run()
              }
            >
              <AlignCenterOutlined />
            </button>
            <button
              onClick={() => editor.chain().focus().setTextAlign("right").run()}
            >
              <AlignRightOutlined />
            </button>

            {/* Lists */}
            <button
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={editor.isActive("bulletList") ? "is-active" : ""}
            >
              <UnorderedListOutlined />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={editor.isActive("orderedList") ? "is-active" : ""}
            >
              <OrderedListOutlined />
            </button>

            {/* Insert Link */}
            <button onClick={addLink}>
              <LinkOutlined />
            </button>
          </BubbleMenu>
          <MenuBar editor={editor} addLink={addLink} />

          <EditorContent editor={editor} />
          <div className="flex flex-row">
            <Button type="primary" onClick={handleSave} className="flex items-center">
              Save
            </Button>
            <Popconfirm
              title="Are you sure you want to cancel your changes?"
              onConfirm={handleCancel}
              onCancel={() => {}}
              okText="Yes"
              cancelText="No"
            >
              <Button type="" className="flex items-center">Cancel</Button>
            </Popconfirm>
          </div>
        </>
      )}
      {!editMode && (
        <div dangerouslySetInnerHTML={{ __html: details.description }} />
      )}
    </div>
  );
};

export default RichEditor;
