#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 22.13 或更高版本（推荐 24），并在项目目录运行 npm ci，再重新启动。"
  read -r -p "按回车键退出…"
  exit 1
fi
node server.mjs --open
read -r -p "程序已退出，按回车键关闭…"
