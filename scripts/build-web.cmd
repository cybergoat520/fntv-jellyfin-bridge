@echo off
REM 构建 jellyfin-web 并打包为 bridge-rust\web.zip
REM 用法: scripts\build-web.cmd

setlocal enabledelayedexpansion

set "ROOT_DIR=%~dp0.."
set "WEB_SRC=%ROOT_DIR%\jellyfin-web"
set "ZIP_DEST=%ROOT_DIR%\bridge-rust\web.zip"

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

echo [3/3] 打包为 web.zip...
if exist "%ZIP_DEST%" del "%ZIP_DEST%"
cd /d "%WEB_SRC%\dist"
powershell -Command "Compress-Archive -Path '.\*' -DestinationPath '%ZIP_DEST%' -Force"

echo.
echo 完成! web.zip 已输出到: %ZIP_DEST%
echo 将 web.zip 放到 bridge-rust 工作目录后重启服务即可自动解压。
