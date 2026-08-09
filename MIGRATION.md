# AutoPCR 本地化前后端 —— 手提电脑迁移说明

> 本文档说明：如何把本地化修改过的 AutoPCR 前端 + 后端部署流程，迁移到另一台电脑（如手提电脑）并正常使用。

## 一、整个工作流概览

```
[手提电脑/本机]                          [远程服务器]
AutoPCR_Web 前端仓库                    HoshinoBot 后端模块
  ├─ 修改源码                          ├─ hoshino/modules/autopcr/
  ├─ pnpm/npm run build ──► dist       ├─ _download_web.py（部署脚本）
  └─ build_web_zip.ps1 打包 ──► zip    └─ autopcr/http_server/ClientApp（前端放置处）
                                          │
         上传 zip ──► python3 _download_web.py xx.zip（自动安装）
```

## 二、需要迁移的内容

| 项目 | 位置 | 是否随电脑迁移 |
|------|------|:---:|
| 前端源码 | `AutoPCR_Web/` 整个仓库 | ✅ 是 |
| 前端打包脚本 | `AutoPCR_Web/build_web_zip.ps1` | ✅ 是（在仓库内） |
| 后端部署脚本 | `HoshinoBot/hoshino/modules/autopcr/_download_web.py` | ✅ 是（在模块内） |
| 后端本体 | `HoshinoBot/`（Hoshino 及其插件） | ✅ 是 |
| 前端构建产物 | `AutoPCR_Web/dist/` | ⚠️ 可选（gitignore，可不迁移） |
| 上传用 zip | `autopcr_web_<版本>.zip` | ❌ 否（打包即删/用完即删） |

> 关键点：**两个脚本都是"随所在仓库/模块一起拷贝"即可**，内部路径全部自适应（用脚本自身位置定位），不依赖原机器的磁盘路径。

## 三、新电脑首次使用步骤

### 1. 环境准备（一次性）
- 安装 **Node.js**（自带 npm）
- （可选）安装 pnpm：`npm i -g pnpm`。不装也行，脚本会自动回退到 npm
- 确认远程服务器有 **Python 3**

### 2. 拷贝代码
把 `AutoPCR_Web` 前端仓库、`HoshinoBot` 后端目录整体拷到新电脑任意位置。

### 3. 本机构建 + 打包（新电脑上）
在 `AutoPCR_Web` 仓库根目录打开 PowerShell：
```powershell
.\build_web_zip.ps1
```
- 自动检测包管理器（pnpm/npm）
- 自动安装依赖（首次）
- 根据 `.web_version` 标记判断是否重建（版本更新会自动重建）
- 生成 `autopcr_web_<版本号>.zip`

### 4. 上传到远程服务器
把 `autopcr_web_<版本号>.zip` 上传到服务器的 `hoshino/modules/autopcr/` 目录。

### 5. 远程安装前端
```bash
cd hoshino/modules/autopcr
python3 _download_web.py autopcr_web_<版本号>.zip
```
脚本会自动：清空旧 `ClientApp` → 解压 → 读取 zip 内 `.web_version` 写入 `client_version` → 删除 zip。

## 四、日常更新流程（版本改动后）

1. 改完前端代码，必要时更新 `package.json` 的 `version`
2. 运行 `.\build_web_zip.ps1` → 版本标记变化会自动重建并重新打包
3. 上传新 zip → 服务器运行 `python3 _download_web.py 新zip`

## 五、常见问题

**Q1：新电脑上 dist 存在但没版本标记，会怎样？**
会安全地触发一次重建（因为标记未知），确保产物与当前源码一致。

**Q2：脚本里 `CANDIDATE_DIST` 还留着旧机器路径，要紧吗？**
不要紧。那是 `_download_web.py` 本机复制模式的自动探测候选，找不到时用 `--dist` 显式指定即可。且它属于后端模块，远程场景用的是 zip 模式，不受影响。

**Q3：`client_version` 没更新会有什么影响？**
后端可能向前端请求版本对比时显示旧版本号，一般不影响功能。zip 模式若 zip 内含 `.web_version` 会自动更新。

**Q4：能直接在后端同机使用本地 dist 吗？**
可以，运行：
```bash
python _download_web.py --dist <AutoPCR_Web路径>/dist
```

## 六、脚本参数速查

`build_web_zip.ps1`（前端仓库）：
- `.\build_web_zip.ps1` —— 自动构建 + 打包
- `.\build_web_zip.ps1 -Force` —— 强制重建

`_download_web.py`（后端模块）：
- `python _download_web.py xx.zip` —— 远程 zip 安装
- `python _download_web.py --dist <路径>` —— 本机 dist 复制
