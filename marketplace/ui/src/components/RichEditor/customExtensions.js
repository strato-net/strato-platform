import { Extension } from "@tiptap/react";

export const FontSize = Extension.create({
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
  
export const FontFamily = Extension.create({
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