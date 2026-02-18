@echo off
REM 构建 jellyfin-web 并复制到 bridge-node\web\
REM 用法: scripts\build-web.cmd

setlocal enabledelayedexpansion

set "ROOT_DIR=%~dp0.."
set "WEB_SRC=%ROOT_DIR%\jellyfin-web"
set "WEB_DEST=%ROOT_DIR%\bridge-node\web"

echo === 构建 jellyfin-web ===

if not exist "%WEB_SRC%\package.json" (
    echo 错误: jellyfin-web 子模块未初始化
    echo 运行: git submodule update --init jellyfin-web
    exit /b 1
)

cd /d "%WEB_SRC%"

echo [1/3] 安装依赖...
call npm ci
if errorlevel 1 exit /b 1

echo [2/3] 构建生产版本...
call npx cross-env NODE_ENV=production webpack --config webpack.prod.js
if errorlevel 1 exit /b 1

echo [3/3] 复制到 bridge-node\web\...
if exist "%WEB_DEST%" rmdir /s /q "%WEB_DEST%"
xcopy /e /i /q "%WEB_SRC%\dist" "%WEB_DEST%"

echo.
echo 完成! Web UI 已输出到: %WEB_DEST%
