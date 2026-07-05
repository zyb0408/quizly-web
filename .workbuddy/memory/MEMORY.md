# 项目记忆 - 直播答题 PWA

## 项目概述
基于抖音弹幕监听（DouyinLiveWS.js）的直播答题 PWA 应用，9:16 竖屏布局。

## 技术栈
- 纯前端 HTML/CSS/JS（无构建工具）
- PWA：manifest.json + sw.js（Service Worker 离线缓存）
- 数据持久化：localStorage（storage.js 封装）
- 弹幕接入：DouyinLiveWS.js 连接本地 ws://127.0.0.1:1088

## 文件结构
- index.html - 主答题页（9:16 竖屏）
- settings.html - 设置页（直播间配置 + 题目管理）
- css/styles.css - 全部样式
- js/storage.js - 本地存储工具（题目CRUD/导入导出/排行榜）
- js/app.js - 主页逻辑（答题/倒计时/弹幕监听/排行榜计分）
- js/settings.js - 设置页逻辑
- sw.js - Service Worker
- manifest.json - PWA 清单
- icons/ - PNG/SVG 图标
- 示例题库.csv - 测试用题库

## 关键设计
- 答题计分：答对 +10 基础分 + 剩余时间奖励；每人每题仅首次作答有效
- 弹幕答案识别：直播间发送 A/B/C/D（忽略大小写）即视为作答
- 题目导入：CSV/JSON，按 科目+序号 去重
- HTTP 服务器：python3 -m http.server 8080

## 运行方式
```
cd /Users/yingbin/Desktop/codex_projects/dati
python3 -m http.server 8080
# 访问 http://localhost:8080
```
