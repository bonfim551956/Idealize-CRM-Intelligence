import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    fontSize: {
      xs: ["12px", "1.5"], sm: ["14px", "1.5"], base: ["16px", "1.5"],
      lg: ["20px", "1.2"], xl: ["24px", "1.2"], "2xl": ["32px", "1.2"], "3xl": ["48px", "1.2"],
    },
    extend: {
      colors: {
        brand: { DEFAULT: "#3DB7A5", 50: "#EEF9F7", 100: "#D3F0EB", 600: "#2A8F81", 700: "#1F6F64", 800: "#185A51" },
        ink: { DEFAULT: "#1A1A1A", 900: "#0F0F0F", 700: "#3A3F44", 500: "#5F666D", 300: "#C9CED3", 200: "#E3E6E9", 100: "#F0F2F4" },
        paper: { DEFAULT: "#FAFAFA", 2: "#F5F5F5" },
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
