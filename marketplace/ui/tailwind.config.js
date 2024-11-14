/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    screens: {
      sm: '480px',
      md: '768px',
      lg: '976px',
      xl: '1440px',
      '2xl': '1600px',
      '3xl': '2000PX',
      '4xl': '2400px',
      '5xl': '2800px',
    },
    colors: {
      black: '#000',
      white: '#fff',
      grayDark: '#273444',
      gray: '#8492a6',
      grayLight: '#d3dce6',
      primary: '#181EAC',
      primaryB: '#1D1D1D',
      primaryC: '#4E4D4B',
      primaryHover: '#101481',
      secondry: '#F9F9F9',
      secondryB: '#6F6E6D',
      secondryC: '#959593',
      secondryD: '#C5C5C4',
      tertiary: '#E3E3E3',
      tertiaryB: '#E2E2E2',
      tertiaryC: '#C5C5C4',
      success: '#109B2E',
      error: '#FF0000',
      blue: '#0E3BDA',
      orange: '#FF8C00',
    },
    boxShadow: {
      form: '0px 4px 59px 10px #73737326',
      card_shadow: '0px 0px 14px 0px #00000015',
      category: '0px 4px 14px 0px #00000026',
      header: '0px 4px 6px 0px #00000010',
    },
    fontFamily: {
      sans: ['Montserrat', 'sans-serif'],
      serif: ['Montserrat', 'serif'],
      arial: ['Arial', 'sans-serif'],
    },

    extend: {
      spacing: {
        128: '32rem',
        144: '36rem',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        Footer: '0px -4px 4px 0px #00000029',
      },
      lineHeight: {
        12: '4.25rem',
      },
    },
  },
  plugins: [],
};
