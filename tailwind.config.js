/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // O(マル・白・先攻) vs X(バツ・黒・後攻)。白黒どちらも映えるよう背景は中間トーン寄りのダーク。
        'bg-void': '#14161B',
        'bg-surface': '#1E222A',
        'col-o': '#F2F2F2', // 白プレイヤー
        'col-x': '#AEB6C6', // 黒プレイヤー（UI上は視認性のため明スレート）
        'col-gold': '#FFD700',
        'col-ui': '#8B92A5',
        'col-border': '#262B36',
      },
      fontFamily: {
        mono: ['"DM Mono"', 'ui-monospace', 'monospace'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        pulseDanger: {
          '0%, 100%': { backgroundColor: 'rgba(232,64,64,0)' },
          '50%': { backgroundColor: 'rgba(232,64,64,0.35)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        countPop: {
          '0%': { transform: 'scale(0.4)', opacity: '0' },
          '40%': { transform: 'scale(1.1)', opacity: '1' },
          '100%': { transform: 'scale(0.9)', opacity: '0' },
        },
      },
      animation: {
        'pulse-danger': 'pulseDanger 1s ease-in-out infinite',
        blink: 'blink 1.1s ease-in-out infinite',
        'count-pop': 'countPop 1s ease-in-out forwards',
      },
    },
  },
  plugins: [],
};
