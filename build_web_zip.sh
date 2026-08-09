#!/usr/bin/env bash
# ============================================================
# 构建并打包 AutoPCR_Web 前端，生成上传用的 zip（Git Bash / Linux / macOS 通用）
# ============================================================
# 用法（在前端仓库根目录运行）:
#   ./build_web_zip.sh              # 版本过期时自动构建，然后打包
#   ./build_web_zip.sh --force      # 强制重新构建
#
# 输出:
#   dist/...                  构建产物（内含 .web_version 版本标记）
#   autopcr_web_<版本号>.zip  上传用压缩包（内含 index.html + assets/，与后端 ClientApp 目录结构一致）
#
# 上传 zip 到远程服务器后，在 autopcr 模块目录运行:
#   python3 _download_web.py autopcr_web_<版本号>.zip
#
# 说明:
#   - 脚本通过自身路径定位仓库根目录，不写死磁盘路径，可随仓库整体拷贝到任意电脑。
#   - 版本号从 package.json 动态读取，不写死。
#   - 包管理器自动检测：优先 pnpm，没有则回退 npm。
# ============================================================

set -e

FORCE=0
for arg in "$@"; do
  if [ "$arg" = "--force" ] || [ "$arg" = "-f" ]; then
    FORCE=1
  fi
done

# ---- 仓库根目录（脚本所在位置），自适应，无写死路径 ----
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# ---- 自动检测包管理器：pnpm 优先，回退 npm ----
PM=""
if command -v pnpm >/dev/null 2>&1; then
  PM="pnpm"
elif command -v npm >/dev/null 2>&1; then
  PM="npm"
else
  echo "ERROR: neither pnpm nor npm found. Install Node.js first." >&2
  exit 1
fi
echo "Package manager: $PM"

# ---- 从 package.json 读取版本号 ----
VERSION="$(node -p "require('./package.json').version")"
echo "AutoPCR_Web version: $VERSION"

# ---- 缺少依赖时安装 ----
if [ ! -d "node_modules" ]; then
  echo "[1/4] Installing dependencies ($PM install) ..."
  "$PM" install
else
  echo "[1/4] node_modules present, skip install."
fi

# ---- 判断是否需要构建（解决版本更新问题） ----
MARKER="dist/.web_version"
NEED_BUILD=0
if [ "$FORCE" = "1" ]; then
  NEED_BUILD=1
elif [ ! -d "dist" ]; then
  NEED_BUILD=1
elif [ ! -f "$MARKER" ]; then
  # dist 存在但没有版本标记，来源未知，安全起见重建
  NEED_BUILD=1
else
  OLD_VERSION="$(cat "$MARKER")"
  if [ "$OLD_VERSION" != "$VERSION" ]; then
    # 版本号已更新（如改了 package.json），自动重新构建
    echo "  Version changed: marker=$OLD_VERSION current=$VERSION"
    NEED_BUILD=1
  fi
fi

if [ "$NEED_BUILD" = "1" ]; then
  echo "[2/4] Building frontend ($PM build) ..."
  # 清理旧 dist，避免新旧资源混用
  rm -rf dist
  "$PM" run build
else
  echo "[2/4] dist is up-to-date (version $VERSION), skip build."
fi

# ---- 校验构建产物 ----
if [ ! -f "dist/index.html" ]; then
  echo "ERROR: dist is missing index.html. Build may be incomplete. Delete dist and retry." >&2
  exit 1
fi

# ---- 把当前版本写入 dist 版本标记 ----
echo "$VERSION" > "$MARKER"

# ---- 打包 zip（内容直接是 index.html + assets/，不带 dist 外层目录） ----
ZIP_NAME="autopcr_web_${VERSION}.zip"
ZIP_PATH="$REPO_ROOT/$ZIP_NAME"
rm -f "$ZIP_PATH"

echo "[3/4] Packaging $ZIP_NAME ..."
# 用 zip 命令进入 dist 目录打包，确保 zip 内不含 dist 外层目录
(cd dist && zip -r -q "$ZIP_PATH" .)

echo ""
echo "[4/4] Build done!"
echo "  Frontend output: $REPO_ROOT/dist  (version marker: $VERSION)"
echo "  Upload file:     $ZIP_PATH"
echo ""
echo "After uploading to the remote server, install it in the autopcr module dir:"
echo "  python3 _download_web.py $ZIP_NAME"
