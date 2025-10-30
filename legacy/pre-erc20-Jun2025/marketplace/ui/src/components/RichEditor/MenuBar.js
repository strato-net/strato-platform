import React, { useState } from 'react';
import { Dropdown } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import './index.css';

const MenuBar = ({ editor, addLink }) => {
  const [selectedFontSize, setSelectedFontSize] = useState('12px');
  const [selectedFontFamily, setSelectedFontFamily] = useState('Arial');

  if (!editor) {
    return;
  }

  editor.on('selectionUpdate', ({ editor }) => {
    const attrs = editor.getAttributes('textStyle');

    setSelectedFontSize(attrs.fontSize || '');
    setSelectedFontFamily(
      attrs.fontFamily ? attrs.fontFamily.split(',')[0] : ''
    );
  });

  const fontSizes = [
    '12px',
    '14px',
    '16px',
    '18px',
    '20px',
    '24px',
    '28px',
    '32px',
    '36px',
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
    'Arial, sans-serif',
    'Georgia, serif',
    'Impact, sans-serif',
    'Tahoma, sans-serif',
    'Times New Roman, serif',
    'Verdana, sans-serif',
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

  const buttonStyling = (type) => {
    return `py-[2.5px] px-[5px] m-1 border border-gray rounded cursor-pointer font-arial font-extralight text-sm transition duration-300 ease-in-out hover:bg-tertiary ${editor.isActive(type) ? 'bg-primaryB text-white' : 'bg-white text-[#616161]'}`;
  };

  const nonActiveButtonStyling =
    'py-[2.5px] px-[5px] mx-1 border border-gray rounded cursor-pointer font-arial font-extralight bg-white text-[#616161] text-sm transition duration-300 ease-in-out hover:bg-tertiary';

  return (
    <>
      {/* Bold */}
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={!editor.can().chain().focus().toggleBold().run()}
        className={buttonStyling('bold')}
      >
        Bold
      </button>

      {/* Italic */}
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={!editor.can().chain().focus().toggleItalic().run()}
        className={buttonStyling('italic')}
      >
        Italic
      </button>

      {/* Underline Button */}
      <button
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={buttonStyling('underline')}
      >
        Underline
      </button>
      {/* Strike */}
      <button
        onClick={() => editor.chain().focus().toggleStrike().run()}
        disabled={!editor.can().chain().focus().toggleStrike().run()}
        className={buttonStyling('strike')}
      >
        Strike
      </button>

      {/* Text Alignment */}
      <button
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
        className={buttonStyling({ textAlign: 'left' })}
      >
        Left
      </button>
      <button
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        className={buttonStyling({ textAlign: 'center' })}
      >
        Center
      </button>
      <button
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        className={buttonStyling({ textAlign: 'right' })}
      >
        Right
      </button>

      <Dropdown
        menu={{
          items: fontSizeMenuItems,
          onClick: ({ key }) => handleFontSizeClick(key),
        }}
        trigger={['click']}
      >
        <button
          onClick={(e) => e.preventDefault()}
          className={nonActiveButtonStyling}
        >
          {selectedFontSize || '12px'} <DownOutlined />
        </button>
      </Dropdown>

      <Dropdown
        menu={{
          items: fontFamilyMenuItems,
          onClick: ({ key }) => handleFontFamilyClick(key),
        }}
        trigger={['click']}
      >
        <button
          onClick={(e) => e.preventDefault()}
          className={nonActiveButtonStyling}
        >
          {selectedFontFamily ? selectedFontFamily.split(',')[0] : 'Arial'}{' '}
          <DownOutlined />
        </button>
      </Dropdown>

      {/* Bullet List */}
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={buttonStyling('bulletList')}
      >
        Bullet List
      </button>

      {/* Ordered List */}
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={buttonStyling('orderedList')}
      >
        Ordered List
      </button>

      {/* Blockquote */}
      <button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={buttonStyling('blockquote')}
      >
        Blockquote
      </button>

      {/* Button for inserting links */}
      <button onClick={addLink} className={nonActiveButtonStyling}>
        Insert Link
      </button>

      {/* Horizontal Rule */}
      <button
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        className={nonActiveButtonStyling}
      >
        Divider
      </button>

      {/* Hard Break */}
      <button
        onClick={() => editor.chain().focus().setHardBreak().run()}
        className={nonActiveButtonStyling}
      >
        New Line
      </button>

      {/* Undo */}
      <button
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().chain().focus().undo().run()}
        className={nonActiveButtonStyling}
      >
        Undo
      </button>

      {/* Redo */}
      <button
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().chain().focus().redo().run()}
        className={nonActiveButtonStyling}
      >
        Redo
      </button>
      {/* Clear Marks */}
      <button
        onClick={() => editor.chain().focus().unsetAllMarks().run()}
        className={nonActiveButtonStyling}
      >
        Clear Marks
      </button>

      {/* Clear Nodes */}
      <button
        onClick={() => editor.chain().focus().clearNodes().run()}
        className={nonActiveButtonStyling}
      >
        Clear Formatting
      </button>

      {/* Custom color picker */}
      <button className={nonActiveButtonStyling}>
        <input
          type="color"
          onInput={(event) =>
            editor.chain().focus().setColor(event.target.value).run()
          }
          value={editor.getAttributes('textStyle').color}
          data-testid="setColor"
        />
      </button>
    </>
  );
};

export default MenuBar;
