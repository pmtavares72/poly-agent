import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg:       '#05050a',
        bg2:      '#0d0d14',
        bg3:      '#13131d',
        surface:  '#16161f',
        surface2: '#1e1e2a',
        green:    '#00e87a',
        red:      '#ff3d5a',
        yellow:   '#f0b429',
        purple:   '#7c3aed',
        cyan:     '#00c2ff',
        text1:    '#e8e8f0',
        text2:    '#8888a0',
        text3:    '#555568',
      },
      fontFamily: {
        mono: ['var(--font-dm-mono)', 'monospace'],
        sans: ['var(--font-syne)', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
