#!/usr/bin/env bash
# ============================================================
# 构建并打包 AutoPCR_Web 前端，生成上传用的 zip，并同步到本机后端
# （Git Bash / Linux / macOS 通用）
# ============================================================
# 用法（在前端仓库根目录运行）:
#   ./build_web_zip.sh              # 版本过期时自动构建，然后打包 + 同步本机后端
#   ./build_web_zip.sh --force      # 强制重新构建
#   ./build_web_zip.sh --skip-local # 只打包 zip，不同步本机后端
#
# 输出:
#   dist/...                  构建产物（内含 .web_version 版本标记）
#   autopcr_web_<版本号>.zip  上传用压缩包（内含 index.html + assets/，与后端 ClientApp 目录结构一致）
#
# 同步:
#   构建后会把 dist 复制到本机后端 ClientApp，方便本地直接启动后端测试。
#   目标路径由 LOCAL_BACKEND_CLIENTAPP 控制。
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
SKIP_LOCAL=0
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=1 ;;
    --skip-local) SKIP_LOCAL=1 ;;
  esac
done

# ---- 仓库根目录（脚本所在位置），自适应，无写死路径 ----
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# ---- 本机后端 ClientApp 目录（用于本地测试同步，可改为你的实际路径） ----
LOCAL_BACKEND_CLIENTAPP="E:/Project/HoshinoBot/hoshino/modules/autopcr/autopcr/http_server/ClientApp"

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
  echo "[1/5] Installing dependencies ($PM install) ..."
  "$PM" install
else
  echo "[1/5] node_modules present, skip install."
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
  echo "[2/5] Building frontend ($PM build) ..."
  # 清理旧 dist，避免新旧资源混用
  rm -rf dist
  "$PM" run build
else
  echo "[2/5] dist is up-to-date (version $VERSION), skip build."
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

echo "[3/5] Packaging $ZIP_NAME ..."
# 优先用 Python zipfile 打包：生成的 zip 内部使用正斜杠 '/'，
# 在任何系统（尤其 Linux 后端）都能正确解压，避免 Windows
# Compress-Archive 反斜杠分隔符导致的问题。
if command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then
  PY_BIN="python"
  command -v python >/dev/null 2>&1 || PY_BIN="python3"
  "$PY_BIN" - "$ZIP_PATH" "$REPO_ROOT/dist" <<'PYEOF'
import os, sys, zipfile
zip_path, dist_dir = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(dist_dir):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, dist_dir).replace(os.sep, '/')  # 强制正斜杠
            zf.write(full, rel)
PYEOF
elif command -v zip >/dev/null 2>&1; then
  # 有 zip 命令（Linux/macOS）：进入 dist 打包，避免外层目录（zip 本身用正斜杠）
  (cd dist && zip -r -q "$ZIP_PATH" .)
else
  echo "ERROR: no 'python'/'zip' available for packaging." >&2
  exit 1
fi

# ---- 同步到本机后端 ClientApp（本地测试用） ----
# LOCAL_BACKEND_CLIENTAPP 是 Windows 路径，bash 不识别，需用 cygpath 转成 MSYS 路径(/e/...)
BACKEND_MSYS="$(cygpath -u "$LOCAL_BACKEND_CLIENTAPP" 2>/dev/null || echo "$LOCAL_BACKEND_CLIENTAPP")"
if [ "$SKIP_LOCAL" = "1" ]; then
  echo "[4/5] Skip local sync (--skip-local)."
elif [ -d "$BACKEND_MSYS" ]; then
  echo "[4/5] Syncing to local backend: $BACKEND_MSYS"
  # 清空旧的 ClientApp，避免残留旧资源
  rm -rf "$BACKEND_MSYS"/*
  cp -R dist/. "$BACKEND_MSYS"/
  echo "  Local backend synced (version $VERSION)."
else
  echo "[4/5] Local backend path not found, skip sync: $BACKEND_MSYS"
fi

echo ""
echo "[5/5] Build done!"
echo "  Frontend output: $REPO_ROOT/dist  (version marker: $VERSION)"
echo "  Upload file:     $ZIP_PATH"
echo ""
echo "After uploading to the remote server, install it in the autopcr module dir:"
echo "  python3 _download_web.py $ZIP_NAME"
