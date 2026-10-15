@echo off
chcp 65001 >nul
title 触摸年轮 · 本地预览服务
cd /d "%~dp0"

echo ============================================
echo   触摸年轮 · 蒙藏学校旧址中华民族共同体数字记忆
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [!] 未找到 python，将直接用浏览器打开 index.html
  start "" "%~dp0index.html"
  goto :eof
)

echo 正在启动本地服务 http://127.0.0.1:8000 ...
start "" "http://127.0.0.1:8000/"
python server.py
pause
