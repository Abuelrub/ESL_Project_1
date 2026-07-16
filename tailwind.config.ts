import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dbe6fe",
          500: "#4f6ef7",
          600: "#3d55e0",
          700: "#3143b8",
        },
      },
    },
  },
  plugins: [],
};
export default config;
