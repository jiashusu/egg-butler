# 蛋蛋管家

蛋蛋管家是一个给蛋蛋记录吃饭、喝水、排便、尿尿的小型 PWA。它支持本地离线记录、趋势预测、数据可视化和 Vercel Blob 云端自动同步，适合在手机浏览器里当作日常照护工具使用。

## 功能

- 快速记录喝水、吃饭、排便、尿尿
- 喝水默认 `607ml`，吃饭默认 `465g`
- 排便状态记录：正常、少量、拉稀、偏软、偏干
- 首页预测下一次吃喝上厕所时间
- 详细数据页：今日概览、7 天趋势、记录占比、最近记录表
- 主设备同步码一键绑定和复制
- 基于 IndexedDB 的本地存储
- 基于 Vercel Blob 的云端自动同步
- PWA 支持，可离线访问已缓存页面

## 技术栈

- 原生 HTML / CSS / JavaScript
- Dexie + IndexedDB
- Chart.js
- Vercel Serverless Function
- Vercel Blob

## 本地运行

```bash
npm install
vercel dev
```

如果只想预览静态页面，也可以用：

```bash
python3 -m http.server 4173
```

云端同步接口需要 Vercel Blob 环境变量。项目绑定 Vercel 后运行：

```bash
vercel env pull .env.local
```

## 检查

```bash
npm run check
npm audit --omit=dev
```

## 部署

```bash
vercel build --prod
vercel deploy --prebuilt --prod
```

线上入口：

[https://egg-butler.vercel.app](https://egg-butler.vercel.app)

## 数据说明

记录会优先保存在当前浏览器的 IndexedDB 中。绑定同一个同步码后，应用启动时会自动从云端合并记录，新增、删除或清空记录后会自动上传。同步码用于定位同一份云端数据，请妥善保存。
