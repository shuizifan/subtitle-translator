/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // standalone 产物便于在宝塔「Node 项目」+ PM2 下部署
  output: "standalone",
};

export default nextConfig;
