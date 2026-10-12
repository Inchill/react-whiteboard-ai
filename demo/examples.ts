/**
 * Prompts a first-time visitor can send with one click. They play to what boxes, lines and text
 * do well: structure, layout and annotation.
 */
export const EXAMPLES: { label: string; prompt: string }[] = [
    {
        label: '系统架构图',
        prompt: '画一个前后端分离的 Web 系统架构图：浏览器、CDN、前端应用、API 网关、用户服务、订单服务、MySQL 和 Redis。分层从上到下排列，用箭头标出调用方向。',
    },
    {
        label: '登录页线框图',
        prompt: '画一个手机登录页的线框图：顶部 Logo，账号和密码两个输入框，一个登录按钮，下方是“忘记密码”和“注册账号”两个链接。',
    },
    {
        label: '四象限矩阵',
        prompt: '画一个“重要 / 紧急”四象限矩阵，坐标轴写上标签，每个象限用不同颜色的半透明底色，并各写两条示例任务。',
    },
    {
        label: '韦恩图',
        prompt: '画一个三个圆的韦恩图，三个圆分别是“设计”“开发”“产品”，用半透明填充，三者重叠的中心写上“好产品”。',
    },
    { label: '全部改成蓝色', prompt: '把白板上所有图形的颜色改成蓝色。' },
];
