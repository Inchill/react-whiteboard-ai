/**
 * Prompts for the model eval, each with what a correct diagram must contain. Labels match when the
 * expected text appears in a box (case and spaces ignored), so "API 网关" matches "API网关".
 */
export type PromptCase = {
    id: string;
    title: string;
    prompt: string;
    /** Sent after `prompt` in the same session, with the board as the first prompt left it. */
    followUp?: string;
    expect: {
        /** Each must appear in some box or text on the board. */
        nodes: string[];
        /** [from, to] by label: an add_diagram edge whose ends contain these texts. */
        edges?: [string, string][];
    };
};

export const PROMPT_CASES: PromptCase[] = [
    {
        id: 'arch-text',
        title: '一段描述 → 系统架构图',
        prompt:
            '我们的系统是这样的：用户通过 App 和网页访问，请求先到 Nginx，再转发给 API 网关。网关后面有用户服务、商品服务、订单服务和支付服务。' +
            '订单服务下单后会发消息到 Kafka，库存服务和通知服务订阅这个消息。用户和订单数据存在 MySQL，商品数据存在 MongoDB，热点数据缓存在 Redis。' +
            '支付服务会调用第三方的微信支付和支付宝。请画出系统架构图。',
        expect: {
            nodes: ['App', '网页', 'Nginx', 'API 网关', '用户服务', '商品服务', '订单服务', '支付服务', 'Kafka', '库存服务', '通知服务', 'MySQL', 'MongoDB', 'Redis', '微信支付', '支付宝'],
            edges: [
                ['Nginx', 'API 网关'],
                ['API 网关', '订单服务'],
                ['订单服务', 'Kafka'],
                ['用户服务', 'MySQL'],
                ['订单服务', 'MySQL'],
                ['商品服务', 'MongoDB'],
                ['支付服务', '微信支付'],
                ['支付服务', '支付宝'],
            ],
        },
    },
    {
        id: 'leave-flow',
        title: '会议纪要 → 请假审批流程图',
        prompt:
            '根据会议纪要画一个请假审批流程：员工提交请假申请，3 天以内由直属主管审批；超过 3 天，主管审批通过后还要部门经理审批。' +
            '任何一步驳回都通知员工并结束；全部通过后通知人事备案，再通知员工。',
        expect: {
            nodes: ['提交', '主管', '经理', '人事', '通知员工'],
            edges: [
                ['提交', '主管'],
                ['主管', '经理'],
            ],
        },
    },
    {
        id: 'er',
        title: '表结构 → 数据关系图',
        prompt:
            '根据这些表画出数据关系图：users(id, name)，orders(id, user_id, created_at)，order_items(id, order_id, product_id, qty)，' +
            'products(id, name, category_id)，categories(id, name)，reviews(id, user_id, product_id, rating)。',
        expect: {
            nodes: ['users', 'orders', 'order_items', 'products', 'categories', 'reviews'],
            edges: [
                ['users', 'orders'],
                ['orders', 'order_items'],
                ['products', 'order_items'],
                ['categories', 'products'],
                ['users', 'reviews'],
                ['products', 'reviews'],
            ],
        },
    },
    {
        id: 'arch-edit',
        title: '在已有架构图上修改',
        prompt: '画一个系统架构图：App 和网页访问 API 网关，网关后面是用户服务和订单服务，两个服务都用 MySQL。',
        followUp: '把订单服务拆成订单服务和购物车服务，购物车数据放 Redis；再加一个日志服务，所有服务都把日志发给它。',
        expect: {
            nodes: ['App', '网页', 'API 网关', '用户服务', '订单服务', '购物车服务', 'Redis', '日志服务', 'MySQL'],
        },
    },
    {
        id: 'web-arch',
        title: '示例：前后端分离架构',
        prompt: '画一个前后端分离的 Web 系统架构图：浏览器、CDN、前端应用、API 网关、用户服务、订单服务、MySQL 和 Redis。分层从上到下排列，用箭头标出调用方向。',
        expect: { nodes: ['浏览器', 'CDN', '前端', 'API 网关', '用户服务', '订单服务', 'MySQL', 'Redis'] },
    },
    {
        id: 'login',
        title: '示例：登录流程',
        prompt: '画一个用户登录流程图：打开登录页、输入账号密码、服务端校验；校验通过进入首页，失败则提示错误并回到输入账号密码。',
        expect: {
            nodes: ['登录页', '账号密码', '校验', '首页', '错误'],
            edges: [
                ['校验', '首页'],
                ['错误', '账号密码'],
            ],
        },
    },
    {
        id: 'org',
        title: '示例：组织架构',
        prompt: '画一个公司组织架构图：CEO 下面有 CTO、CFO、COO；CTO 管前端团队和后端团队，CFO 管财务部，COO 管运营部和客服部。',
        expect: {
            nodes: ['CEO', 'CTO', 'CFO', 'COO', '前端', '后端', '财务', '运营', '客服'],
            edges: [
                ['CEO', 'CTO'],
                ['CTO', '前端'],
                ['COO', '客服'],
            ],
        },
    },
    {
        id: 'pipeline',
        title: '示例：发布流水线',
        prompt: '从左到右画一个发布流水线：提交代码、代码检查、单元测试、构建镜像、部署预发、人工审批、部署生产。',
        expect: { nodes: ['提交代码', '代码检查', '单元测试', '构建镜像', '部署预发', '人工审批', '部署生产'] },
    },
];
