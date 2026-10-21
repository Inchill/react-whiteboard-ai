import type { Lang } from './i18n';

export type Example = { label: string; prompt: string };
/** `hint`: shown under the group's examples while deep thinking is off. */
export type ExampleGroup = { id: string; label: string; hint?: string; examples: Example[] };

/**
 * One-click prompts for a first visit, grouped by the tool they show off. Each prompt is specific
 * enough for the model to do well: hand-drawn sketches, auto-laid-out diagrams, free layouts with
 * boxes and text, and edits to what is already on the board. The model answers and labels the
 * drawing in the language of the prompt, so each language has its own set.
 */
export const EXAMPLE_GROUPS: Record<Lang, ExampleGroup[]> = {
    zh: [
        {
            id: 'sketch',
            label: '手绘',
            hint: '打开下方的「深度思考」，线稿会画得更准，但要多等一会儿。',
            examples: [
                { label: '小老鼠头像', prompt: '画一只圆耳朵的卡通小老鼠头像：粉色内耳，圆眼睛，小鼻子，两边各有几根胡须。' },
                { label: '坐着的小猫', prompt: '画一只坐着的小猫，侧着头，尾巴卷在身前。' },
                { label: '仙人掌盆栽', prompt: '画一盆仙人掌：两条手臂向上弯，绿色线条，种在橙色的陶土花盆里。' },
                { label: '热气球', prompt: '画一个热气球，球面有竖向条纹，下面挂着小吊篮，旁边飘着两朵云。' },
                { label: '一杯咖啡', prompt: '画一杯冒着热气的咖啡，杯子有把手，杯身上画一颗红色的爱心。' },
            ],
        },
        {
            id: 'diagram',
            label: '结构图',
            examples: [
                {
                    label: '系统架构图',
                    prompt: '画一个前后端分离的 Web 系统架构图：浏览器、CDN、前端应用、API 网关、用户服务、订单服务、MySQL 和 Redis。分层从上到下排列，用箭头标出调用方向。',
                },
                { label: '登录流程', prompt: '画一个用户登录流程图：打开登录页、输入账号密码、服务端校验；校验通过进入首页，失败则提示错误并回到输入账号密码。' },
                { label: '组织架构', prompt: '画一个公司组织架构图：CEO 下面有 CTO、CFO、COO；CTO 管前端团队和后端团队，CFO 管财务部，COO 管运营部和客服部。' },
                { label: '发布流水线', prompt: '从左到右画一个发布流水线：提交代码、代码检查、单元测试、构建镜像、部署预发、人工审批、部署生产。' },
            ],
        },
        {
            id: 'layout',
            label: '布局',
            examples: [
                { label: '登录页线框图', prompt: '画一个手机登录页的线框图：顶部 Logo，账号和密码两个输入框，一个登录按钮，下方是“忘记密码”和“注册账号”两个链接。' },
                { label: '四象限矩阵', prompt: '画一个“重要 / 紧急”四象限矩阵，坐标轴写上标签，每个象限用不同颜色的浅色底色，并各写两条示例任务。' },
                { label: '韦恩图', prompt: '画一个三个圆的韦恩图，三个圆分别是“设计”“开发”“产品”，用半透明填充，三者重叠的中心写上“好产品”。' },
            ],
        },
        {
            id: 'edit',
            label: '编辑',
            examples: [
                { label: '全部改成蓝色', prompt: '把白板上所有图形的颜色改成蓝色。' },
                { label: '删掉最后一个', prompt: '删掉最后画的那个图形。' },
            ],
        },
    ],
    en: [
        {
            id: 'sketch',
            label: 'Sketch',
            hint: 'Turn on "Deep thinking" below for more accurate sketches, at the cost of a longer wait.',
            examples: [
                { label: 'Mouse face', prompt: 'Draw a cartoon mouse face with round ears: pink inner ears, round eyes, a small nose and a few whiskers on each side.' },
                { label: 'Sitting cat', prompt: 'Draw a sitting kitten with its head tilted and its tail curled in front of it.' },
                { label: 'Potted cactus', prompt: 'Draw a potted cactus: two arms curving upward, green lines, in an orange terracotta pot.' },
                { label: 'Hot-air balloon', prompt: 'Draw a hot-air balloon with vertical stripes and a small basket underneath, with two clouds floating beside it.' },
                { label: 'Cup of coffee', prompt: 'Draw a steaming cup of coffee with a handle and a red heart on the cup.' },
            ],
        },
        {
            id: 'diagram',
            label: 'Diagrams',
            examples: [
                {
                    label: 'Architecture',
                    prompt: 'Draw the architecture of a web app with a separate frontend and backend: browser, CDN, frontend app, API gateway, user service, order service, MySQL and Redis. Arrange the layers top to bottom and show call directions with arrows.',
                },
                { label: 'Login flow', prompt: 'Draw a login flowchart: open the login page, enter username and password, server checks them; on success go to the home page, on failure show an error and return to entering the username and password.' },
                { label: 'Org chart', prompt: 'Draw a company org chart: the CEO has a CTO, CFO and COO; the CTO leads the frontend and backend teams, the CFO leads finance, and the COO leads operations and customer support.' },
                { label: 'Release pipeline', prompt: 'Draw a release pipeline from left to right: commit, lint, unit tests, build image, deploy to staging, manual approval, deploy to production.' },
            ],
        },
        {
            id: 'layout',
            label: 'Layouts',
            examples: [
                { label: 'Login wireframe', prompt: 'Draw a wireframe of a mobile login page: a logo at the top, username and password fields, a login button, and "Forgot password" and "Sign up" links below.' },
                { label: '2×2 matrix', prompt: 'Draw an important / urgent 2×2 matrix with labeled axes, a different light background color in each quadrant, and two example tasks in each.' },
                { label: 'Venn diagram', prompt: 'Draw a Venn diagram of three circles labeled "Design", "Engineering" and "Product", with translucent fills, and "Great product" where all three overlap.' },
            ],
        },
        {
            id: 'edit',
            label: 'Edit',
            examples: [
                { label: 'Make it all blue', prompt: 'Change the color of every shape on the board to blue.' },
                { label: 'Delete the last one', prompt: 'Delete the shape that was drawn last.' },
            ],
        },
    ],
};

const GROUP_KEY = 'react-whiteboard-ai-demo:examples';

export function loadExampleGroup(): string {
    try {
        const id = localStorage.getItem(GROUP_KEY);
        if (id && EXAMPLE_GROUPS.zh.some((g) => g.id === id)) return id;
    } catch {
        /* storage unavailable */
    }
    return EXAMPLE_GROUPS.zh[0].id;
}

export function saveExampleGroup(id: string) {
    try {
        localStorage.setItem(GROUP_KEY, id);
    } catch {
        /* storage unavailable: the choice lasts for this page only */
    }
}
