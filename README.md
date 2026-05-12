# Tech Cross Repair Centre - 门户网站

现代化的3C电子设备维修中心门户网站，专为移动设备优化。

## 🌐 在线访问

**网站地址**: https://lee15148863.github.io/teschcross/

## ✨ 特性

- 📱 移动优先的响应式设计
- 🎨 品牌配色（黄绿色背景 + 深蓝色强调）
- 🌍 双语支持（英语/爱尔兰语）
- 💫 流畅的动画和交互效果
- 🚀 纯静态网站，加载速度快
- 📞 一键拨号和邮件功能

## 🛠️ 服务项目

- 屏幕更换（手机/平板/笔记本）
- 电池更换
- 进水维修
- 免费诊断
- 笔记本维修（键盘/铰链/升级）
- 游戏机维修（PS5/Xbox/Switch）

## 📱 联系方式

- **电话**: 046 905 9854
- **邮箱**: techcrossnavan@gmail.com
- **地址**: Ireland

## 🚀 部署说明

### 自动部署（已配置）

每次推送到 `main` 分支，GitHub Actions 会自动部署到 GitHub Pages。

### 手动部署

1. 启用 GitHub Pages：
   - 进入仓库 Settings → Pages
   - Source 选择 "GitHub Actions"
   - 保存设置

2. 推送代码触发部署：
```bash
git add .
git commit -m "更新内容"
git push
```

## 💻 本地开发

1. 克隆仓库：
```bash
git clone https://github.com/Lee15148863/teschcross.git
cd teschcross
```

2. 启动本地服务器：
```bash
# 使用 Python
python -m http.server 8000

# 或使用 Node.js
npx http-server -p 8000
```

3. 访问 http://localhost:8000

## 📁 项目结构

```
├── index.html          # 主页面
├── styles.css          # 样式文件
├── script.js           # JavaScript 脚本
├── logo.png            # Tech Cross Logo
├── README.md           # 项目说明
├── DEPLOY.md           # 详细部署指南
└── .github/
    └── workflows/
        └── pages.yml   # GitHub Pages 自动部署
```

## 🎨 配色方案

- **背景色**: #D4E157（品牌黄绿色）
- **主色调**: #1976D2（深蓝色）
- **文字色**: #2C3E50（深灰色）
- **强调色**: #1E88E5（亮蓝色）

## 🌍 浏览器支持

- ✅ Chrome/Edge (推荐)
- ✅ Safari
- ✅ Firefox
- ✅ 移动端浏览器

## 📝 更新日志

### v1.0.0 (2024)
- ✨ 初始版本发布
- 🎨 品牌配色设计
- 🌍 英语/爱尔兰语双语支持
- 📱 完全响应式设计
- 🔧 6大维修服务展示

## 📄 许可

MIT License

---

© 2024 Tech Cross Repair Centre. All rights reserved.
