/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // standalone 仅在打发行版包时启用（npm run release 会设置此变量）
  // Vercel / Netlify 等平台部署时不设置此变量，走默认模式
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
};

export default nextConfig;
