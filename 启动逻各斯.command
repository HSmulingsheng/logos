#!/bin/bash
# 逻各斯 —— 古希腊语学习平台，双击启动
set -e
cd "$(dirname "$0")"

# 找 node：优先系统 node，其次常见的 nvm / Homebrew 安装位置
NODE=""
if command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  for cand in "$HOME/.nvm/versions/node"/*/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
    [ -x "$cand" ] && NODE="$cand" && break
  done
fi

if [ -z "$NODE" ]; then
  echo "未找到 node，请先安装 Node.js 18+ 后重试。"
  read -r -p "按回车退出…" _
  exit 1
fi

if [ ! -f "app/dist/index.html" ]; then
  echo "首次运行，正在构建前端（约 10 秒）…"
  ( cd app && "$NODE" node_modules/vite/bin/vite.js build )
fi

echo "正在启动网页版…浏览器会自动打开。关闭此窗口即停止服务。"
echo ""
echo "  手机 / 平板：连同一个 Wi-Fi，扫下面二维码，或输入打印出来的局域网地址。"
echo "  只给本机用：把下面的 serve.mjs 4178 改成 serve.mjs 4178 --local"
echo ""
echo "（想要原生桌面体验，参见 README 的「桌面版」一节）"
exec "$NODE" app/scripts/serve.mjs 4178 --open
