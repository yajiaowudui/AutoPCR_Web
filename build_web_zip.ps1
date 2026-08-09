# ============================================================
# 构建并打包 AutoPCR_Web 前端，生成上传用的 zip，并同步到本机后端
# ============================================================
# 用法（在前端仓库根目录运行）:
#   .\build_web_zip.ps1             # 版本过期时自动构建，然后打包 + 同步本机后端
#   .\build_web_zip.ps1 -Force      # 强制重新构建
#   .\build_web_zip.ps1 -SkipLocal  # 只打包 zip，不同步本机后端
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
#   - 脚本通过自身路径($PSScriptRoot)定位仓库根目录，不写死磁盘路径，
#     整个仓库拷贝到任何电脑（如手提电脑）都能直接运行。
#   - 版本号从 package.json 动态读取，不写死。
#   - 包管理器自动检测：优先 pnpm，没有则回退 npm。
# ============================================================

param([switch]$Force, [switch]$SkipLocal)

$ErrorActionPreference = "Stop"

# ---- 仓库根目录（脚本所在位置），自适应，无写死路径 ----
$RepoRoot = $PSScriptRoot
Set-Location $RepoRoot

# ---- 本机后端 ClientApp 目录（用于本地测试同步，可改为你的实际路径） ----
$LocalBackendClientApp = "E:\Project\HoshinoBot\hoshino\modules\autopcr\autopcr\http_server\ClientApp"

# ---- 自动检测包管理器：pnpm 优先，回退 npm（跨电脑自适应） ----
$PM = ""
foreach ($c in "pnpm", "npm") {
    if (Get-Command $c -ErrorAction SilentlyContinue) { $PM = $c; break }
}
if (-not $PM) { throw "Neither pnpm nor npm found. Install Node.js first." }
Write-Host "Package manager: $PM" -ForegroundColor Cyan

# ---- 从 package.json 读取版本号（自适应，不写死） ----
$pkg = Get-Content -Raw "package.json" | ConvertFrom-Json
$Version = $pkg.version
Write-Host "AutoPCR_Web version: $Version" -ForegroundColor Cyan

# ---- 缺少依赖时安装 ----
if (-not (Test-Path "node_modules")) {
    Write-Host "[1/5] Installing dependencies ($PM install) ..." -ForegroundColor Yellow
    & $PM install
    if ($LASTEXITCODE -ne 0) { throw "$PM install failed" }
} else {
    Write-Host "[1/5] node_modules present, skip install." -ForegroundColor Green
}

# ---- 判断是否需要构建（解决版本更新问题） ----
$Marker = Join-Path $RepoRoot "dist\.web_version"
$needBuild = $false
if ($Force) {
    # 显式要求强制重建
    $needBuild = $true
} elseif (-not (Test-Path "dist")) {
    # 无 dist 目录，必须构建
    $needBuild = $true
} elseif (-not (Test-Path $Marker)) {
    # dist 存在但没有版本标记，来源未知，安全起见重建
    $needBuild = $true
} elseif ((Get-Content $Marker -Raw).Trim() -ne $Version) {
    # 版本号已更新（如改了 package.json），自动重新构建
    Write-Host "  Version changed: marker=$((Get-Content $Marker -Raw).Trim()) current=$Version" -ForegroundColor Yellow
    $needBuild = $true
}

if ($needBuild) {
    Write-Host "[2/5] Building frontend ($PM build) ..." -ForegroundColor Yellow
    # 清理旧 dist，避免新旧资源混用
    if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" }
    & $PM run build
    if ($LASTEXITCODE -ne 0) { throw "$PM build failed" }
} else {
    Write-Host "[2/5] dist is up-to-date (version $Version), skip build." -ForegroundColor Green
}

# ---- 校验构建产物 ----
if (-not (Test-Path "dist\index.html")) {
    throw "dist is missing index.html. Build may be incomplete. Delete dist and retry."
}

# ---- 把当前版本写入 dist 版本标记（供后端自动读取 client_version） ----
Set-Content -Path $Marker -Value $Version -Encoding ascii

# ---- 打包 zip（内容直接是 index.html + assets/，不带 dist 外层目录） ----
$ZipName = "autopcr_web_$Version.zip"
$ZipPath = Join-Path $RepoRoot $ZipName
if (Test-Path $ZipPath) { Remove-Item $ZipPath }

Write-Host "[3/5] Packaging $ZipName ..." -ForegroundColor Yellow
# 用 Python zipfile 打包，确保 zip 内部使用正斜杠 '/'，
# 避免 Compress-Archive 反斜杠分隔符导致 Linux 后端解压错误。
$DistDir = Join-Path $RepoRoot "dist"
$pyCode = @'
import os, sys, zipfile
zip_path, dist_dir = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(dist_dir):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, dist_dir).replace(os.sep, '/')
            zf.write(full, rel)
'@
python -c $pyCode $ZipPath $DistDir

# ---- 同步到本机后端 ClientApp（本地测试用） ----
if ($SkipLocal) {
    Write-Host "[4/5] Skip local sync (-SkipLocal)." -ForegroundColor Green
} elseif (Test-Path $LocalBackendClientApp) {
    Write-Host "[4/5] Syncing to local backend: $LocalBackendClientApp" -ForegroundColor Yellow
    # 清空旧的 ClientApp，避免残留旧资源
    Remove-Item -Recurse -Force (Join-Path $LocalBackendClientApp "*") -ErrorAction SilentlyContinue
    Copy-Item -Path "dist\*" -Destination $LocalBackendClientApp -Recurse -Force
    Write-Host "  Local backend synced (version $Version)." -ForegroundColor Green
} else {
    Write-Host "[4/5] Local backend path not found, skip sync: $LocalBackendClientApp" -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "[5/5] Build done!" -ForegroundColor Green
Write-Host "  Frontend output: $RepoRoot\dist  (version marker: $Version)"
Write-Host "  Upload file:     $ZipPath"
Write-Host ""
Write-Host "After uploading to the remote server, install it in the autopcr module dir:" -ForegroundColor Cyan
Write-Host "  python3 _download_web.py $ZipName"
