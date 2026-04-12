import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: [".next/**", "node_modules/**", "dist/**", "coverage/**"],
  },
];

export default eslintConfig;
