import React, { useState, useEffect } from 'react';
import { useEditor, EditorContent, BubbleMenu, Extension } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Color from '@tiptap/extension-color';
import TextStyle from '@tiptap/extension-text-style';
import ListItem from '@tiptap/extension-list-item';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import Heading from '@tiptap/extension-heading';
import Underline from '@tiptap/extension-underline';
import Paragraph from '@tiptap/extension-paragraph';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import {
  FontFamily,
  FontSize,
  BlockquoteNode,
  UnorderedListNode,
  OrderedListNode,
} from './customExtensions.js';

import './index.css';
import {
  BoldOutlined,
  ItalicOutlined,
  UnderlineOutlined,
  StrikethroughOutlined,
  AlignLeftOutlined,
  AlignCenterOutlined,
  AlignRightOutlined,
  OrderedListOutlined,
  UnorderedListOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import MenuBar from './MenuBar.js';

const RichEditor = ({ onChange, initialValue }) => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Color.configure({ types: [TextStyle.name, ListItem.name] }),
      TextStyle.configure({ types: [ListItem.name] }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      FontFamily,
      FontSize,
      Link,
      Heading,
      Underline,
      Color,
      Underline,
      Paragraph,
      BlockquoteNode,
      UnorderedListNode,
      OrderedListNode,
      Document,
      Text,
    ],
    content: initialValue,
    editable: true,
    onUpdate: ({ editor }) => {
      const htmlContent = editor.getHTML();
      onChange(htmlContent);
    },
  });

  // allows tiptap blockquote to work properly
  useEffect(() => {
    const styleElement = document.createElement('style');
    styleElement.innerHTML = `
      .ProseMirror blockquote {
        padding-left: 1rem;
        border-left: 2px solid rgba(13, 13, 13, 0.1);
      }
    `;
    document.head.appendChild(styleElement);

    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);

  // allows tiptap bullet list to work properly
  useEffect(() => {
    const styleElement = document.createElement('style');
    styleElement.innerHTML = `
      .ProseMirror ul {
        padding: 0 1rem;
        list-style: disc;
      }
    `;
    document.head.appendChild(styleElement);

    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);

  // allows tiptap ordered list to work properly
  useEffect(() => {
    const styleElement = document.createElement('style');
    styleElement.innerHTML = `
      .ProseMirror ol {
        padding: 0 1rem;
        list-style: decimal;
      }
    `;
    document.head.appendChild(styleElement);

    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);

  useEffect(() => {
    if (initialValue && editor) {
      editor.commands.setContent(initialValue, false);
    }
  }, [initialValue, editor]);

  if (!editor) {
    return null;
  }

  const addLink = () => {
    // Prompt the user for a URL
    const url = window.prompt('Enter the URL');

    // Check if a URL was provided
    if (url) {
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: url })
        .run();
    }
  };

  return (
    <div className="tiptap">
      <BubbleMenu
        className="bubble-menu"
        editor={editor}
        tippyOptions={{ duration: 100 }}
      >
        {/* Bold */}
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editor.can().chain().focus().toggleBold().run()}
          className={editor.isActive('bold') ? 'is-active' : ''}
        >
          <BoldOutlined />
        </button>

        {/* Italic */}
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editor.can().chain().focus().toggleItalic().run()}
          className={editor.isActive('italic') ? 'is-active' : ''}
        >
          <ItalicOutlined />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          disabled={!editor.can().chain().focus().toggleUnderline().run()}
          className={editor.isActive('underline') ? 'is-active' : ''}
        >
          <UnderlineOutlined />
        </button>

        {/* Strike */}
        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          disabled={!editor.can().chain().focus().toggleStrike().run()}
          className={editor.isActive('strike') ? 'is-active' : ''}
        >
          <StrikethroughOutlined />
        </button>

        {/* Align Text */}
        <button
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
        >
          <AlignLeftOutlined />
        </button>
        <button
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
        >
          <AlignCenterOutlined />
        </button>
        <button
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
        >
          <AlignRightOutlined />
        </button>

        {/* Lists */}
        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={editor.isActive('bulletList') ? 'is-active' : ''}
        >
          <UnorderedListOutlined />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={editor.isActive('orderedList') ? 'is-active' : ''}
        >
          <OrderedListOutlined />
        </button>

        {/* Insert Link */}
        <button onClick={addLink}>
          <LinkOutlined />
        </button>
      </BubbleMenu>
      <MenuBar editor={editor} addLink={addLink} />

      <EditorContent className="mt-2" editor={editor} />
    </div>
  );
};

export default RichEditor;
