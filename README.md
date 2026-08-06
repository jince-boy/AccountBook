# 生意账本

一款面向个体经营者和小型生意的 Windows 桌面记账工具。它支持多个独立生意项目，以 JSON 保存全部账本数据，并提供收入、支出、追加投入、余额、回报率和趋势分析。

- 当前版本：`2.0.0`
- 作者：`Jince`
- 支持系统：Windows 10 / 11（x64）
- 默认安装目录：`D:\AccountBook`

## 主要功能

### 多项目工作区

- 启动后进入项目中心，可创建、导入、打开和移除项目
- 每个项目拥有独立账本、独立备份和独立窗口
- 可以同时操作多个生意项目，同一项目不会被重复打开
- 账本窗口内可以直接切换、创建或导入其他项目
- 应用保持单实例运行，项目窗口可以有多个

### 资金记录与统计

- 设置项目名称和初始本金
- 记录收入、支出、追加投入及说明
- 交易时间精确到分钟
- 所有金额以整数“分”保存，避免浮点金额误差
- 自动计算当前余额、净收益、累计投入和投入回报率
- 支持编辑、删除、搜索和筛选历史记录
- 提供日、周、月资金趋势和分类支出分析

### JSON 导入、导出与保护

- 当前项目可以随时导出为标准 JSON 文件
- 导入 JSON 时会创建新项目，不覆盖现有账本
- 每次保存前保留上一版 `ledger.backup.json`
- 移除项目只会移动到工作区 `.trash`，不会立即永久删除
- 可以在设置中迁移整个数据工作区，原位置数据仍会保留

### 界面与桌面体验

- 浅色、深色和跟随系统三种主题
- 内置 JetBrains Mono 与 Noto Sans SC 字体
- 支持关闭到系统托盘，托盘右键菜单仅保留“退出”
- 自定义日期时间、下拉框、通知和确认组件
- 项目中心固定为 `900 × 620`，项目账本固定为 `1040 × 680`

## 安装与更新

### 安装

从仓库的 **Releases** 页面下载最新的 `.exe` 安装程序。为保证自动更新链接跨平台兼容，Release 中的资源名可能显示为 `ledgerly-account-book-setup-版本号.exe`。

安装器默认使用：

```text
D:\AccountBook
```

安装时仍可选择其他目录。由于采用全局安装模式，Windows 会请求管理员权限。

### 检查更新

打开“全局设置”中的“软件更新”，可以查看当前版本并手动检查更新。应用启动后也会在后台检查一次：

1. 发现新版本后显示版本提示；
2. 由用户主动点击“下载更新”；
3. 下载完成后点击“重启安装”。

应用不会自动安装，也不会把账本数据上传到网络。除检查 GitHub Release 更新外，记账功能完全在本地运行。

> 从 GitHub Actions 普通分支构建产物安装的版本也包含仓库更新地址，但只有正式 GitHub Release 会被识别为最新版本。

## 数据保存位置

默认工作区位于 Electron 用户数据目录：

```text
%APPDATA%\生意账本\workspace\
├─ projects\
│  └─ <项目 UUID>\
│     ├─ ledger.json
│     └─ ledger.backup.json
└─ .trash\
```

全局设置单独保存在：

```text
%APPDATA%\生意账本\settings.json
%APPDATA%\生意账本\settings.json.backup
```

实际工作区位置可以在“全局设置”中查看和修改，项目中心不会直接显示保存路径。

## JSON 数据示例

```json
{
  "version": 1,
  "profile": {
    "businessName": "城南咖啡店",
    "initialCapitalCents": 10000000,
    "currency": "CNY"
  },
  "transactions": [
    {
      "id": "唯一交易编号",
      "kind": "income",
      "amountCents": 125050,
      "occurredAt": "2026-08-06T09:30",
      "category": "销售收入",
      "note": "门店营业收入",
      "createdAt": "2026-08-06T01:30:00.000Z",
      "updatedAt": "2026-08-06T01:30:00.000Z"
    }
  ],
  "meta": {
    "createdAt": "2026-08-06T01:00:00.000Z",
    "updatedAt": "2026-08-06T01:30:00.000Z"
  }
}
```

`kind` 支持：

- `income`：收入
- `expense`：支出
- `investment`：追加投入

资金公式：

```text
当前余额 = 初始本金 + 追加投入 + 收入 - 支出
净收益   = 收入 - 支出
回报率   = 净收益 ÷（初始本金 + 追加投入）× 100%
```

## 本地开发

环境要求：Node.js 22、npm、Windows。

```powershell
npm.cmd ci
npm.cmd run dev
```

常用命令：

```powershell
npm.cmd test        # 运行自动化测试
npm.cmd run check   # TypeScript 类型检查
npm.cmd run build   # 生成前端生产文件
npm.cmd run dist    # 生成 Windows NSIS 安装包
```

主要技术栈：Electron、React、TypeScript、Vite、Recharts、Vitest、electron-builder、electron-updater。

## GitHub 自动构建与发布

工作流文件位于 `.github/workflows/windows-release.yml`。

### 普通推送

向 `master` 或 `main` 推送代码后，GitHub Actions 会自动：

1. 安装锁定依赖；
2. 运行测试和 TypeScript 检查；
3. 构建前端；
4. 生成 Windows 安装包；
5. 上传为 Actions 构建产物并保留 14 天。

### 发布新版本

版本标签必须与 `package.json` 的 `version` 完全一致。例如发布 `2.0.1`：

```powershell
npm.cmd version patch -m "chore: release v%s"
git push origin master
git push origin --tags
```

推送 `v2.0.1` 标签后，工作流会自动创建正式 GitHub Release，并上传：

- Windows 安装包 `.exe`（GitHub 使用兼容自动更新的安全文件名）
- 差分更新文件 `.blockmap`
- 客户端版本清单 `latest.yml`

客户端通过这些 Release 文件检测、下载并安装最新版本。GitHub Actions 使用仓库自带的 `GITHUB_TOKEN`，不需要额外配置发布密钥。

## 项目结构

```text
electron/       Electron 主进程和安全预加载脚本
src/            React 界面、账本逻辑与测试
src/assets/     应用内置字体
build/          图标与 NSIS 安装脚本
scripts/        图标和 CI 发布辅助脚本
.github/        GitHub Actions 自动构建配置
```

## 许可证

本项目使用 MIT License。作者：Jince。
