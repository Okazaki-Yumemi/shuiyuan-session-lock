# Shuiyuan Session Lock

一个用于水源社区的 Tampermonkey / Violentmonkey 用户脚本。

它会在访问水源社区时询问“这次不看水源多久”，然后在所选时间内锁定水源社区的非课业学习内容，只允许访问课业学习板块。

允许访问的默认路径：

```text
https://shuiyuan.sjtu.edu.cn/c/sjtu-study/academic-study
```

## 功能

* 访问水源时弹窗选择锁定时长
* 支持 15 分钟、30 分钟、1 小时、2 小时、4 小时、8 小时、12 小时
* 支持自定义分钟数
* 锁定期间只允许访问课业学习板块
* 选择后 30 秒内可以撤销，不消耗强制取消次数
* 每天最多 5 次强制取消专注机会
* 弹窗可以关闭，关闭后不会立刻反复弹出
* 使用 Tampermonkey 存储记录锁定状态和每日强制取消次数

## 安装

### 方式一：手动安装

1. 安装 Tampermonkey 或 Violentmonkey。
2. 新建用户脚本。
3. 复制 `shuiyuan-session-lock.user.js` 的全部内容。
4. 保存脚本。
5. 打开或刷新水源社区页面。

### 方式二：从脚本托管平台安装

如果脚本已经发布到 Greasy Fork、GitHub Gist 或 GitHub Release，可以直接点击对应的 `.user.js` 链接安装。

## 使用方法

打开水源社区后，脚本会弹出选择窗口：

```text
这次不看水源多久？
```

选择时长后，在倒计时结束前，访问水源社区其他页面时会被锁定，课业学习板块仍然可以访问。

如果刚刚选择后反悔，可以在 30 秒内点击：

```text
撤销刚刚的选择
```

这不会消耗每日强制取消次数。

如果 30 秒后仍需要退出锁定，可以点击：

```text
强制取消专注
```

每天最多使用 5 次。

## 配置

主要配置位于脚本顶部：

```javascript
const STUDY_URL = "https://shuiyuan.sjtu.edu.cn/c/sjtu-study/academic-study";
const ALLOWED_PREFIX = "/c/sjtu-study/academic-study";
const MAX_FORCE_EXITS_PER_DAY = 5;
const UNDO_WINDOW_MS = 30 * 1000;
```

可以自行修改：

* 允许访问的板块路径
* 每日强制取消次数
* 反悔窗口时间
* 默认可选锁定时长

## 注意事项

这个脚本是浏览器侧软锁，主要用于减少无意识刷帖。它不能阻止用户禁用浏览器插件、换浏览器或换设备访问水源社区。

脚本不是水源社区官方项目，也不代表上海交通大学或水源社区官方立场。

## License

MIT License
