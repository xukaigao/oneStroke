"use strict";

/* ============================================================
   一笔画 (One-Stroke / Eulerian path)
   - 图 = 节点(圆点) + 边(线)。玩家从一个点出发，沿着边一笔连下去，
     每条边走且只走一次，把所有边走完即通关。
   - 边可以是【直线】或【圆弧】；同一对端点之间可以有多条边（如一个圆的两段弧）。
   - 经典关卡手工定义；随机关卡用「随机闭合走线」构造，天然可解、无非节点交叉。
   - 欧拉算法(Hierholzer)用于：校验可解、计算合法起点、提示下一步。
   ============================================================ */

const SVGNS = "http://www.w3.org/2000/svg";

/* 画布：以格点(lattice)为坐标，x ∈ [0..COLS], y ∈ [0..ROWS]（y 向下为正） */
const COLS = 8;
const ROWS = 6;
const CS = 46;      // 每格像素
const PAD = 28;     // 边距
const W = COLS * CS + PAD * 2;
const H = ROWS * CS + PAD * 2;
const SNAP = CS * 0.55;

/* ---------- 坐标 / 边 的 key 工具 ---------- */
const nkey = (x, y) => `${x},${y}`;
const parseNode = (k) => k.split(",").map(Number);
function ekey(a, b) { return a < b ? a + "|" + b : b + "|" + a; } // a,b 为 nkey 字符串
function ekeyXY(x1, y1, x2, y2) { return ekey(nkey(x1, y1), nkey(x2, y2)); }
const px = (x) => PAD + x * CS;
const py = (y) => PAD + y * CS;
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

/* ---------- 关卡构造 ----------
   edge 对象：{ id, a, b, kind:"line"|"arc", ... }
   - line：a、b 为两端点 nkey
   - arc ：a、b 为两端点 nkey；cx,cy,r 为圆心/半径（格点单位）；large,sweep 为 SVG 弧标志
   level：{ name, edges[], nodes:Set, byId:Map, byPair:Map, total } */
function finalizeLevel(name, edges) {
  const byId = new Map();
  const byPair = new Map();
  const nodes = new Set();
  edges.forEach((e, i) => {
    e.id = "e" + i;
    byId.set(e.id, e);
    const pk = ekey(e.a, e.b);
    if (!byPair.has(pk)) byPair.set(pk, []);
    byPair.get(pk).push(e);
    nodes.add(e.a);
    nodes.add(e.b);
  });
  return { name, edges, nodes, byId, byPair, total: edges.length };
}

/* 直线关卡：segs = [[x1,y1,x2,y2], ...]（自动去掉重复的相同直线） */
function makeLevel(name, segs) {
  const seen = new Set();
  const edges = [];
  for (const [x1, y1, x2, y2] of segs) {
    const pk = ekeyXY(x1, y1, x2, y2);
    if (seen.has(pk)) continue;
    seen.add(pk);
    edges.push({ a: nkey(x1, y1), b: nkey(x2, y2), kind: "line" });
  }
  return finalizeLevel(name, edges);
}
function makeLevelFromKeys(name, edgeKeys) {
  const seen = new Set();
  const edges = [];
  for (const ek of edgeKeys) {
    if (seen.has(ek)) continue;
    seen.add(ek);
    const [a, b] = ek.split("|");
    edges.push({ a, b, kind: "line" });
  }
  return finalizeLevel(name, edges);
}

/* 一段圆弧边 */
function arcEdge(x1, y1, x2, y2, cx, cy, r, large, sweep) {
  return { a: nkey(x1, y1), b: nkey(x2, y2), kind: "arc", cx, cy, r, large, sweep };
}

/* 三角配圆：直角三角形 + 竖线/底边 + 一个圆（用两段弧表示）。
   圆在两处相切：竖线切于 S(4,4)、圆顶切于 U(5,3)；另有一条从三角形顶点 D(4,3)
   到圆顶切点 U(5,3) 的水平切线段。
   奇数点为左下角(1,5)与圆顶切点(5,3) → 从左下角起笔、圆顶切点收笔（两个红点）。 */
function triCircleLevel() {
  const line = (x1, y1, x2, y2) => ({ a: nkey(x1, y1), b: nkey(x2, y2), kind: "line" });
  const a = (x1, y1, x2, y2, cx, cy, large, sweep) => arcEdge(x1, y1, x2, y2, cx, cy, 1, large, sweep);
  return finalizeLevel("三角配圆", [
    line(1, 1, 7, 1),        // 顶边
    line(1, 1, 1, 5),        // 左边
    line(7, 1, 4, 3),        // 斜边上段 A–D
    line(4, 3, 1, 5),        // 斜边下段 D–左下角
    line(4, 3, 4, 4),        // 竖线上段 D–S
    line(4, 4, 4, 5),        // 竖线下段 S–C
    line(1, 5, 4, 5),        // 底边
    line(4, 3, 5, 3),        // 切线段 D–U（水平，切于圆顶）
    a(4, 4, 5, 3, 5, 4, 0, 1),   // 圆：切点 S(4,4) → 圆顶 U(5,3)（上左小弧）
    a(5, 3, 4, 4, 5, 4, 1, 1),   // 圆：U(5,3) → S(4,4)（大弧）
  ]);
}

/* 圆心双三角：上下两个锐角三角形顶点相接于圆心 O(4,3)。
   上三角两角 (1,0)(5,0)、下三角两角 (7,6)(3,6)（点对称、略微错开 → 整体倾斜、不板正）。
   两斜边即两条对角线在 O 交叉成 X 并穿过圆；圆上 4 个进出点按实际角度分割 → 4 段弧不等长。
   所有点偶数度 → 欧拉回路，任意点起笔皆可。 */
function doubleTriCircleLevel() {
  const ox = 4, oy = 3, R = 1.4;
  const O = nkey(ox, oy);
  const corners = [[1, 0], [5, 0], [7, 6], [3, 6]];   // 上左、上右、下右、下左
  const bases = [[[1, 0], [5, 0]], [[7, 6], [3, 6]]]; // 上底、下底
  const round = (v) => Math.round(v * 1000) / 1000;   // 统一精度，保证节点 key 一致

  const edges = [];
  const cross = [];
  for (const [cx, cy] of corners) {
    const dx = cx - ox, dy = cy - oy;
    const len = Math.hypot(dx, dy);
    const bx = round(ox + R * dx / len), by = round(oy + R * dy / len);
    const ck = nkey(bx, by);
    edges.push({ a: nkey(cx, cy), b: ck, kind: "line" });   // 角 → 圆上交点
    edges.push({ a: ck, b: O, kind: "line" });              // 圆上交点 → 圆心
    cross.push({ key: ck, angle: Math.atan2(by - oy, bx - ox) });
  }
  for (const [[x1, y1], [x2, y2]] of bases) {
    edges.push({ a: nkey(x1, y1), b: nkey(x2, y2), kind: "line" }); // 底边
  }
  cross.sort((m, n) => m.angle - n.angle);
  for (let i = 0; i < cross.length; i++) {
    const c1 = cross[i], c2 = cross[(i + 1) % cross.length];
    let span = c2.angle - c1.angle;
    if (span < 0) span += Math.PI * 2;
    edges.push({ a: c1.key, b: c2.key, kind: "arc", cx: ox, cy: oy, r: R, large: span > Math.PI ? 1 : 0, sweep: 1 });
  }
  return finalizeLevel("圆心双三角", edges);
}

/* 四个相切圆：2×2 排列，相邻圆相切；4 个切点各偶数度 → 可一笔画成（欧拉回路）。
   每个圆在两个切点处被分成两段弧（内侧短弧 + 外侧长弧），共 8 段弧。 */
function circlesLevel() {
  const r = 1;
  const a = (x1, y1, x2, y2, cx, cy, large, sweep) => arcEdge(x1, y1, x2, y2, cx, cy, r, large, sweep);
  return finalizeLevel("四个圆", [
    // 左上圆（圆心 3,2）：切点 上(4,2) 与 左下(3,3)
    a(4, 2, 3, 3, 3, 2, 0, 1), a(3, 3, 4, 2, 3, 2, 1, 1),
    // 右上圆（圆心 5,2）：切点 下(5,3) 与 左(4,2)
    a(5, 3, 4, 2, 5, 2, 0, 1), a(4, 2, 5, 3, 5, 2, 1, 1),
    // 左下圆（圆心 3,4）：切点 上(3,3) 与 右(4,4)
    a(3, 3, 4, 4, 3, 4, 0, 1), a(4, 4, 3, 3, 3, 4, 1, 1),
    // 右下圆（圆心 5,4）：切点 上(5,3) 与 左(4,4)
    a(4, 4, 5, 3, 5, 4, 0, 1), a(5, 3, 4, 4, 5, 4, 1, 1),
  ]);
}

/* 8 字：两个相切圆（∞ 形）。左右两圆在中点 (4,3) 相切，各被切点与外端点分成上下两段弧。
   所有点偶数度 → 欧拉回路，任意点起笔皆可。 */
function glassesLevel() {
  const a = (x1, y1, x2, y2, cx, cy) => arcEdge(x1, y1, x2, y2, cx, cy, 1.5, 0, 1);
  return finalizeLevel("8 字", [
    a(1, 3, 4, 3, 2.5, 3), a(4, 3, 1, 3, 2.5, 3),   // 左圆 上/下半
    a(4, 3, 7, 3, 5.5, 3), a(7, 3, 4, 3, 5.5, 3),   // 右圆 上/下半
  ]);
}

/* 太极：大外圆 + 中间 S 曲线（两段小半圆）。奇数点为上下顶点 → 从一个顶点起笔、另一个收笔。 */
function taijiLevel() {
  return finalizeLevel("太极", [
    arcEdge(4, 0.5, 4, 5.5, 4, 3, 2.5, 0, 1),      // 外圆右半 (顶→底 过右)
    arcEdge(4, 5.5, 4, 0.5, 4, 3, 2.5, 0, 1),      // 外圆左半 (底→顶 过左)
    arcEdge(4, 0.5, 4, 3, 4, 1.75, 1.25, 0, 1),    // S 上半 (顶→心 向右鼓)
    arcEdge(4, 5.5, 4, 3, 4, 4.25, 1.25, 0, 1),    // S 下半 (底→心 向左鼓)
  ]);
}

/* 花朵：正方形四边各向外鼓出一片半圆花瓣。所有点偶数度 → 欧拉回路，任意点起笔皆可。 */
function flowerLevel() {
  const line = (x1, y1, x2, y2) => ({ a: nkey(x1, y1), b: nkey(x2, y2), kind: "line" });
  const a = (x1, y1, x2, y2, cx, cy) => arcEdge(x1, y1, x2, y2, cx, cy, 1, 0, 1);
  return finalizeLevel("花朵", [
    line(3, 2, 5, 2), line(5, 2, 5, 4), line(5, 4, 3, 4), line(3, 4, 3, 2), // 方形四边
    a(3, 2, 5, 2, 4, 2),   // 上瓣（向上鼓）
    a(5, 2, 5, 4, 5, 3),   // 右瓣（向右鼓）
    a(5, 4, 3, 4, 4, 4),   // 下瓣（向下鼓）
    a(3, 4, 3, 2, 3, 3),   // 左瓣（向左鼓）
  ]);
}

/* 六芒星（大卫之星）：两个三角形交叠。6 个外尖角偶数度、6 个内交叉点偶数度 → 欧拉回路。
   两三角的每条边被 2 个内交叉点切成 3 段（共 18 段），中间交叉都是真节点，视觉上就是两个三角叠成的星。 */
function hexagramLevel() {
  return makeLevel("六芒星", [
    // ▲ 上三角（尖角 顶/左下/右下），每条边切成 3 段
    [4, 0.5, 3.278, 1.75], [3.278, 1.75, 2.557, 3], [2.557, 3, 1.835, 4.25],   // 顶 → 左下
    [1.835, 4.25, 3.278, 4.25], [3.278, 4.25, 4.722, 4.25], [4.722, 4.25, 6.165, 4.25], // 左下 → 右下
    [6.165, 4.25, 5.443, 3], [5.443, 3, 4.722, 1.75], [4.722, 1.75, 4, 0.5],   // 右下 → 顶
    // ▽ 下三角（尖角 底/左上/右上）
    [1.835, 1.75, 3.278, 1.75], [3.278, 1.75, 4.722, 1.75], [4.722, 1.75, 6.165, 1.75], // 左上 → 右上
    [6.165, 1.75, 5.443, 3], [5.443, 3, 4.722, 4.25], [4.722, 4.25, 4, 5.5],   // 右上 → 底
    [4, 5.5, 3.278, 4.25], [3.278, 4.25, 2.557, 3], [2.557, 3, 1.835, 1.75],   // 底 → 左上
  ]);
}

/* 风车：中心 O 向 4 个方向各伸出一片三角形叶片（每片用一个角 + 一条边中点），同向旋转。
   所有点偶数度 → 欧拉回路，任意点起笔皆可。 */
function pinwheelLevel() {
  return makeLevel("风车", [
    [4, 3, 4, 0], [4, 0, 7, 0], [7, 0, 4, 3],   // 叶片 1（右上）
    [4, 3, 7, 3], [7, 3, 7, 6], [7, 6, 4, 3],   // 叶片 2（右下）
    [4, 3, 4, 6], [4, 6, 1, 6], [1, 6, 4, 3],   // 叶片 3（左下）
    [4, 3, 1, 3], [1, 3, 1, 0], [1, 0, 4, 3],   // 叶片 4（左上）
  ]);
}

/* 钥匙：圆形钥匙头（两段弧）+ 匙杆 + 带两个齿的匙齿闭环。
   奇数点为「圆与杆的连接点」和「杆与齿的连接点」→ 一头起笔、一头收笔。 */
function keyLevel() {
  const arcs = [
    arcEdge(0.5, 3, 2.5, 3, 1.5, 3, 1, 0, 1),   // 钥匙头 上弧
    arcEdge(2.5, 3, 0.5, 3, 1.5, 3, 1, 0, 1),   // 钥匙头 下弧
  ];
  const line = (x1, y1, x2, y2) => ({ a: nkey(x1, y1), b: nkey(x2, y2), kind: "line" });
  const lines = [
    line(2.5, 3, 5, 3),                          // 匙杆
    line(5, 3, 7, 3), line(7, 3, 7, 4),          // 匙齿外框 上/右
    line(7, 4, 7, 4.6), line(7, 4.6, 6.3, 4.6), line(6.3, 4.6, 6.3, 4), // 齿1
    line(6.3, 4, 5.7, 4),                        // 齿间
    line(5.7, 4, 5.7, 4.6), line(5.7, 4.6, 5, 4.6), line(5, 4.6, 5, 4), // 齿2
    line(5, 4, 5, 3),                            // 匙齿外框 左（回到连接点）
  ];
  return finalizeLevel("钥匙", [...arcs, ...lines]);
}

/* 字母 B：竖脊（切成上下两段）+ 右侧上下两个半圆鼓包。所有点偶数度 → 欧拉回路。 */
function letterBLevel() {
  const line = (x1, y1, x2, y2) => ({ a: nkey(x1, y1), b: nkey(x2, y2), kind: "line" });
  return finalizeLevel("字母 B", [
    line(2, 1, 2, 3), line(2, 3, 2, 5),           // 竖脊 上/下段
    arcEdge(2, 1, 2, 3, 2, 2, 1, 0, 1),           // 上鼓包（向右）
    arcEdge(2, 3, 2, 5, 2, 4, 1, 0, 1),           // 下鼓包（向右）
  ]);
}

/* 圆里折线：圆 + 圆内折线 A→L→R→B（A 顶、L 左下、R 右、B 右下，均在圆上）。
   圆把 4 点分成 4 段弧；折线 3 段（A-L、L-R、R-B）。
   奇数点为 A、B（两红点）→ 从一个红点起笔、另一个收笔。R-B 处圆弧与折线各一条（多重边）。 */
function circlePolylineLevel() {
  const A = [3.14, 0.65], R = [6.35, 2.14], B = [5.77, 4.77], L = [1.84, 4.25];
  const cx = 4, cy = 3, r = 2.5;
  const arc = (p, q) => arcEdge(p[0], p[1], q[0], q[1], cx, cy, r, 0, 1);
  const line = (p, q) => ({ a: nkey(p[0], p[1]), b: nkey(q[0], q[1]), kind: "line" });
  return finalizeLevel("圆里折线", [
    arc(A, R), arc(R, B), arc(B, L), arc(L, A),   // 4 段圆弧（按角度顺序 A→R→B→L→A）
    line(A, L), line(L, R), line(R, B),           // 折线 A→L→R→B
  ]);
}

/* 圆内三角：圆 + 内接三角形（3 顶点都在圆上）。
   圆被 3 顶点分成 3 段弧，三角形 3 条边；每个顶点 2 弧 + 2 边 = 偶数度 → 欧拉回路，任意点起笔。 */
function circleTriangleLevel() {
  const T = [4, 0.5], BL = [1.835, 4.25], BR = [6.165, 4.25];
  const cx = 4, cy = 3, r = 2.5;
  const arc = (p, q) => arcEdge(p[0], p[1], q[0], q[1], cx, cy, r, 0, 1);
  const line = (p, q) => ({ a: nkey(p[0], p[1]), b: nkey(q[0], q[1]), kind: "line" });
  return finalizeLevel("圆内三角", [
    arc(BR, BL), arc(BL, T), arc(T, BR),    // 3 段弧（按角度递增 BR→BL→T→BR）
    line(T, BL), line(BL, BR), line(BR, T), // 内接三角形三边
  ]);
}

/* 圆里弦弧（第24图）：整圆（4 段边界弧 A-B/B-C/C-D/D-A）+ 折线弦 A-C、C-D
   + 一条从 D 到 B 向上鼓的内弧。逆时针 A(左上红点) B(左下红点) C(底) D(右)。
   C-D 弦与边界弧 C-D 是多重边（已把 C、D 夹角拉大到约 90° 好区分）。
   奇数点为 A、B（两红点）→ 从一个红点起笔、另一个收笔。 */
function circleChordArcLevel() {
  const A = [3.145, 0.651], B = [1.585, 3.647], C = [3.353, 5.415], D = [6.415, 3.647];
  const cx = 4, cy = 3, r = 2.5;
  const arc = (p, q) => arcEdge(p[0], p[1], q[0], q[1], cx, cy, r, 0, 1);
  const line = (p, q) => ({ a: nkey(p[0], p[1]), b: nkey(q[0], q[1]), kind: "line" });
  return finalizeLevel("圆里弦弧", [
    arc(D, C), arc(C, B), arc(B, A), arc(A, D),          // 边界 4 段弧（角度递增 D→C→B→A→D）
    line(A, C), line(C, D),                              // 折线弦 A-C、C-D
    arcEdge(B[0], B[1], D[0], D[1], 4, 4.6, 2.6, 0, 1),  // D↔B 内弧（向上鼓）
  ]);
}

/* ============================================================
   经典关卡（手工定义，已确保可一笔画成）
   ============================================================ */
const CLASSIC = [
  // 1) 三角形：热身，所有点偶数度
  makeLevel("三角形", [[1, 5, 7, 5], [7, 5, 4, 1], [4, 1, 1, 5]]),

  // 2) 蝴蝶结：两三角共顶点，全偶数度
  makeLevel("蝴蝶结", [
    [1, 1, 4, 3], [4, 3, 1, 5], [1, 5, 1, 1],
    [7, 1, 4, 3], [4, 3, 7, 5], [7, 5, 7, 1],
  ]),

  // 3) 五角星：经典 ★，5 点各偶数度（中间交叉不是节点）
  makeLevel("五角星", [
    [4, 0, 6, 6], [6, 6, 1, 2], [1, 2, 7, 2], [7, 2, 2, 6], [2, 6, 4, 0],
  ]),

  // 4) 方块加对角线：恰好 2 个奇数点
  makeLevel("方块斜线", [
    [2, 1, 6, 1], [6, 1, 6, 5], [6, 5, 2, 5], [2, 5, 2, 1], [2, 1, 6, 5],
  ]),

  // 5) 日字：上下两格共一条横边
  makeLevel("日字", [
    [2, 1, 6, 1], [2, 3, 6, 3], [2, 5, 6, 5],
    [2, 1, 2, 3], [2, 3, 2, 5], [6, 1, 6, 3], [6, 3, 6, 5],
  ]),

  // 6) 风筝加横杆：菱形 + 中间横线
  makeLevel("风筝", [
    [4, 0, 7, 3], [7, 3, 4, 6], [4, 6, 1, 3], [1, 3, 4, 0], [1, 3, 7, 3],
  ]),

  // 7) 信封：经典 ✉️，恰好 2 个奇数点（两个底角起收笔）
  makeLevel("信封", [
    [2, 5, 6, 5], [6, 5, 6, 2], [6, 2, 2, 2], [2, 2, 2, 5],
    [2, 5, 6, 2], [6, 5, 2, 2],
    [2, 2, 4, 0], [6, 2, 4, 0],
  ]),

  // 8) 斜角双格：两个正方形在中心角相接，一条对角线贯穿两格；
  //    恰好 2 个奇数点（左上角、右下角），从一角起笔、另一角收笔。
  makeLevel("斜角双格", [
    [2, 1, 4, 1], [4, 1, 4, 3], [4, 3, 2, 3], [2, 3, 2, 1], [2, 1, 4, 3],
    [4, 3, 6, 3], [6, 3, 6, 5], [6, 5, 4, 5], [4, 5, 4, 3], [4, 3, 6, 5],
  ]),

  // 9) 四个圆：2×2 相切圆，全偶数度 → 任意切点起笔皆可
  circlesLevel(),

  // 10) 五边套菱：正五边形内嵌一个菱形，菱形下顶点用短竖线连到底边中点；
  //     恰好 2 个奇数点（底边中点、菱形下顶点），从其一起笔、另一收笔。
  makeLevel("五边套菱", [
    // 五边形（底边在中点 (4,5) 断开）
    [4, 0, 1, 2], [1, 2, 2, 5], [2, 5, 4, 5], [4, 5, 6, 5], [6, 5, 7, 2], [7, 2, 4, 0],
    // 菱形（正方形转 45°）
    [4, 1.5, 5.5, 3], [5.5, 3, 4, 4.5], [4, 4.5, 2.5, 3], [2.5, 3, 4, 1.5],
    // 连接短竖线
    [4, 4.5, 4, 5],
  ]),

  // 11) 折角的纸：矩形右下角折起；折痕 P-Q，折角尖 B 翻到图形内部。
  //     恰好 2 个奇数点（P、Q），从其一起笔、另一收笔。
  makeLevel("折角的纸", [
    [1, 1, 7, 1],        // 顶边
    [1, 1, 1, 5],        // 左边
    [7, 1, 7, 3],        // 右边（到折点 P(7,3)）
    [1, 5, 4.5, 5],      // 底边（到折点 Q(4.5,5)）
    [7, 3, 4.5, 5],      // 折痕 P–Q
    [7, 3, 5, 3],        // 翻折边 P–B（B 在图形内部）
    [4.5, 5, 5, 3],      // 翻折边 Q–B
  ]),

  // 12) 三角配圆：直角三角形 + 竖线/底边 + 贴竖线的圆；
  //     奇数点为左下角与竖线顶端（从左下角起笔、竖线顶端收笔），圆在中途一笔绕过。
  triCircleLevel(),

  // 13) 圆心双三角：上下两三角形顶点相接于圆心，两对角线穿过圆交叉；全偶数度 → 任意点起笔。
  doubleTriCircleLevel(),

  // 14) 三角套 X：大三角形 + 横线 + 两腰下端交叉成 X 接到底边两红点。
  //     奇数点为底边两红点（从一个红点起笔、另一个收笔）；X 交叉点不是节点。
  makeLevel("三角套X", [
    [4, 0, 2.5, 3], [2.5, 3, 1, 6],          // 左腰 T–L–BL
    [4, 0, 5.5, 3], [5.5, 3, 7, 6],          // 右腰 T–R–BR
    [1, 6, 3, 6], [3, 6, 5, 6], [5, 6, 7, 6], // 底边 BL–RD左–RD右–BR
    [2.5, 3, 5.5, 3],                        // 横线 L–R
    [2.5, 3, 5, 6], [5.5, 3, 3, 6],          // X：L–RD右、R–RD左
  ]),

  // 15) 8 字：两个相切圆，全偶数度 → 任意点起笔。
  glassesLevel(),

  // 16) 太极：外圆 + S 曲线，奇数点为上下顶点。
  taijiLevel(),

  // 17) 花朵：方形四边各一片半圆花瓣，全偶数度 → 任意点起笔。
  flowerLevel(),

  // 18) 六芒星（大卫之星）：两三角交叠，全偶数度 → 任意点起笔。
  hexagramLevel(),

  // 19) 风车：中心伸出四片同向旋转的三角叶片，全偶数度 → 任意点起笔。
  pinwheelLevel(),

  // 20) 钥匙：圆头 + 杆 + 双齿，奇数点为两个连接处 → 一头起笔另一头收笔。
  keyLevel(),

  // 21) 字母 B：竖脊 + 右侧两个半圆，全偶数度 → 任意点起笔。
  letterBLevel(),

  // 22) 圆里折线：圆 + 圆内折线 A→L→R→B，奇数点为顶/右下两红点 → 一头起笔另一头收笔。
  circlePolylineLevel(),

  // 23) 圆内三角：圆 + 内接三角形（3 顶点都在圆上），全偶数度 → 任意点起笔。
  circleTriangleLevel(),

  // 24) 圆里弦弧：整圆 + 折线 A→C→D + 内弧 D↔B，奇数点为顶/左两红点 → 一头起笔另一头收笔。
  circleChordArcLevel(),
];

/* ============================================================
   随机关卡：随机「闭合走线」
   只用横/竖单位边（永不在非节点处交叉），走出一条不重复边、
   回到起点的闭合路径 → 连通且各点偶数度 → 必可一笔画成。
   ============================================================ */
function randomLevel() {
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let attempt = 0; attempt < 300; attempt++) {
    const used = new Set();
    const sx = randInt(1, COLS - 1), sy = randInt(1, ROWS - 1);
    let cx = sx, cy = sy;
    const maxSteps = randInt(9, 16);
    const minSteps = 7;
    let steps = 0, closed = false;

    while (steps < maxSteps) {
      const nbrs = [];
      for (const [dx, dy] of DIRS) {
        const qx = cx + dx, qy = cy + dy;
        if (qx < 0 || qx > COLS || qy < 0 || qy > ROWS) continue;
        const ek = ekeyXY(cx, cy, qx, qy);
        if (used.has(ek)) continue;
        nbrs.push([qx, qy, ek]);
      }
      if (!nbrs.length) break;

      const closer = nbrs.find(([qx, qy]) => qx === sx && qy === sy);
      if (steps >= minSteps && closer && (Math.random() < 0.4 || nbrs.length === 1)) {
        used.add(closer[2]);
        closed = true;
        break;
      }
      const open = nbrs.filter(([qx, qy]) => !(qx === sx && qy === sy));
      const pool = open.length ? open : nbrs;
      const pick = pool[randInt(0, pool.length - 1)];
      used.add(pick[2]);
      cx = pick[0]; cy = pick[1];
      steps++;
    }

    if (closed && used.size >= 7) {
      return makeLevelFromKeys("随机图", [...used]);
    }
  }
  // 兜底：一个矩形
  return makeLevel("随机图", [[2, 2, 6, 2], [6, 2, 6, 5], [6, 5, 2, 5], [2, 5, 2, 2]]);
}

/* ============================================================
   欧拉算法（Hierholzer）—— 作用于 edge 对象数组
   ============================================================ */
function degreeMap(edges) {
  const deg = new Map();
  for (const e of edges) {
    deg.set(e.a, (deg.get(e.a) || 0) + 1);
    deg.set(e.b, (deg.get(e.b) || 0) + 1);
  }
  return deg;
}
function oddNodes(edges) {
  const odd = [];
  for (const [k, d] of degreeMap(edges)) if (d % 2 === 1) odd.push(k);
  return odd;
}
/* 合法起点：恰好 2 个奇数点 → 那 2 个；全偶数 → 任意点；否则不可一笔画成 */
function validStarts(edges) {
  const odd = oddNodes(edges);
  if (odd.length === 2) return odd;
  if (odd.length === 0) return [...degreeMap(edges).keys()];
  return [];
}
/* 从 start 出发，返回经过所有边各一次的【边序列】；不存在则返回 null */
function eulerTrailEdges(edges, start) {
  const total = edges.length;
  if (total === 0) return null;
  const adj = new Map();
  const add = (n, e) => { if (!adj.has(n)) adj.set(n, []); adj.get(n).push(e); };
  for (const e of edges) { add(e.a, e); add(e.b, e); }
  if (!adj.has(start)) return null;

  const used = new Set();
  const ptr = new Map();
  const nodeStack = [start];
  const edgeStack = [];   // 到达当前节点所用的边
  const out = [];
  while (nodeStack.length) {
    const v = nodeStack[nodeStack.length - 1];
    const list = adj.get(v) || [];
    let advanced = false;
    while ((ptr.get(v) || 0) < list.length) {
      const i = ptr.get(v) || 0; ptr.set(v, i + 1);
      const e = list[i];
      if (used.has(e.id)) continue;
      used.add(e.id);
      const w = (e.a === v) ? e.b : e.a;
      nodeStack.push(w); edgeStack.push(e); advanced = true; break;
    }
    if (!advanced) {
      nodeStack.pop();
      if (edgeStack.length) out.push(edgeStack.pop());
    }
  }
  if (used.size !== total) return null;
  out.reverse();
  return out.length === total ? out : null;
}

/* ============================================================
   彩虹屁（通关鼓励语，20 句，肯定 6~12 岁孩子的努力与思考）
   ============================================================ */
const PRAISES = [
  "太厉害啦！一笔到底不回头，你的脑袋转得真快！🌟",
  "完美的一笔画！你一定在心里默默规划过路线，真会动脑筋！🧠",
  "哇，每条线都恰好走一次，你观察得好仔细呀！👀",
  "你做到了！遇到岔路也没乱，沉得住气，真棒！💪",
  "这一笔画得又稳又漂亮，你的耐心值得一个大大的赞！👍",
  "聪明的小画家！你找到了别人可能要试好多次的路线～🎨",
  "了不起！你把复杂的图形一笔连成了，思路超清晰！✨",
  "成功啦！能坚持画到最后一条线，你真有毅力！🏆",
  "你的手和脑配合得真好，一笔画成就是这么帅！😎",
  "太赞了！先想清楚再下笔，这就是高手的做法～🚀",
  "哇塞，连这么难的图你都搞定了，太有天赋啦！🌈",
  "每一步都走对，说明你真的认真思考过，真棒！🌻",
  "你像小侦探一样找到了正确的路线，超级聪明！🔍",
  "一笔不差，全部走完！你的专注力满分！💯",
  "画得真好！失败也没关系，你一直在尝试，这最了不起！🌟",
  "厉害厉害！你已经掌握一笔画的小秘密啦～🔑",
  "完成得真漂亮，下笔之前先动脑，这个习惯太好了！🧩",
  "你成功啦！这条彩虹线就是你努力的奖章～🎖️",
  "好棒的一笔画！再难的图也难不倒爱思考的你！🦉",
  "通关啦！你又比刚才更厉害了一点点，继续加油！⭐",
];
const randomPraise = () => PRAISES[Math.floor(Math.random() * PRAISES.length)];

/* ============================================================
   游戏状态
   ============================================================ */
let pool = [...CLASSIC];   // 关卡序列：经典在前，随机的追加在后
let idx = 0;
let level = null;

let drawn = new Set();     // 已画边的 id
let order = [];            // 已画边 id 的顺序
let started = false;
let current = null;        // 当前笔尖所在节点 nkey
let painting = false;
let solved = false;
let praiseTimer = null;

/* DOM 引用 */
let board, svg, gEdges, gNodes, gFx;
let statusEl, levelNameEl, boardCard;
let praiseModal, praiseText;

/* ---------- 渲染 ---------- */
function el(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function buildBoard() {
  board.innerHTML = "";
  svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  gEdges = el("g", {});
  gNodes = el("g", {});
  gFx = el("g", {});
  svg.appendChild(gEdges);
  svg.appendChild(gFx);
  svg.appendChild(gNodes);
  board.appendChild(svg);
  bindDrawing();
  render();
}

/* 一条边的 SVG 元素（直线 -> line，圆弧 -> path） */
function edgeSvg(e) {
  const [x1, y1] = parseNode(e.a);
  const [x2, y2] = parseNode(e.b);
  if (e.kind === "arc") {
    const rp = e.r * CS;
    const d = `M ${px(x1)} ${py(y1)} A ${rp} ${rp} 0 ${e.large} ${e.sweep} ${px(x2)} ${py(y2)}`;
    return el("path", { d, fill: "none" });
  }
  return el("line", { x1: px(x1), y1: py(y1), x2: px(x2), y2: py(y2) });
}

function render() {
  gEdges.innerHTML = "";
  gNodes.innerHTML = "";

  const orderIndex = new Map();
  order.forEach((id, i) => orderIndex.set(id, i));

  // 边
  for (const e of level.edges) {
    const shape = edgeSvg(e);
    shape.setAttribute("data-id", e.id);
    if (drawn.has(e.id)) {
      const i = orderIndex.get(e.id) || 0;
      const hue = (i / Math.max(1, level.total)) * 300;
      shape.setAttribute("class", "edge-done");
      shape.setAttribute("stroke", `hsl(${hue}, 80%, 52%)`);
    } else {
      shape.setAttribute("class", "edge");
    }
    gEdges.appendChild(shape);
  }

  // 节点
  for (const k of level.nodes) {
    const [x, y] = parseNode(k);
    const isCur = started && k === current;
    const c = el("circle", { cx: px(x), cy: py(y), r: isCur ? 8 : 6, class: isCur ? "node-cur" : "node" });
    gNodes.appendChild(c);
    if (isCur) {
      gNodes.appendChild(el("circle", { cx: px(x), cy: py(y), r: 13, class: "node-ring" }));
    }
  }
}

function sparkleAt(k) {
  const [x, y] = parseNode(k);
  const s = el("text", { x: px(x), y: py(y), "text-anchor": "middle", "font-size": 22, class: "sparkle" });
  s.textContent = "✨";
  gFx.appendChild(s);
  setTimeout(() => s.remove(), 500);
}

/* ---------- 几何辅助 ---------- */
/* 一条边中点（像素坐标）——用于同端点多条边时，选离笔尖最近的那条 */
function edgeMidPx(e) {
  const [ax, ay] = parseNode(e.a);
  const [bx, by] = parseNode(e.b);
  if (e.kind === "arc") {
    const a0 = Math.atan2(ay - e.cy, ax - e.cx);
    const a1 = Math.atan2(by - e.cy, bx - e.cx);
    let span = a1 - a0;
    while (span < 0) span += Math.PI * 2;   // 与 sweep=1（顺时针，角度递增）一致
    const mid = a0 + span / 2;
    return [px(e.cx + e.r * Math.cos(mid)), py(e.cy + e.r * Math.sin(mid))];
  }
  return [px((ax + bx) / 2), py((ay + by) / 2)];
}

/* ---------- 交互 ---------- */
function svgPoint(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const scale = W / rect.width;
  return [(clientX - rect.left) * scale, (clientY - rect.top) * scale];
}
function nearestNodeAt(sx, sy) {
  let best = null, bestD = SNAP * SNAP;
  for (const k of level.nodes) {
    const [x, y] = parseNode(k);
    const dx = px(x) - sx, dy = py(y) - sy;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

/* current 与 to 之间尚未画的边 */
function undrawnBetween(from, to) {
  const list = level.byPair.get(ekey(from, to)) || [];
  return list.filter((e) => !drawn.has(e.id));
}
function canStep(from, to) {
  if (from === to) return false;
  return undrawnBetween(from, to).length > 0;
}

/* 走一步：在 current→to 的未画边中，选离笔尖(sx,sy)最近的一条 */
function step(to, sx, sy) {
  const cands = undrawnBetween(current, to);
  if (!cands.length) return;
  let e = cands[0];
  if (cands.length > 1 && sx != null) {
    let best = Infinity;
    for (const c of cands) {
      const [mx, my] = edgeMidPx(c);
      const d = (mx - sx) * (mx - sx) + (my - sy) * (my - sy);
      if (d < best) { best = d; e = c; }
    }
  }
  drawn.add(e.id);
  order.push(e.id);
  current = to;
  render();
  checkWin();
}

function bindDrawing() {
  svg.addEventListener("pointerdown", (e) => {
    if (solved) return;
    const [sx, sy] = svgPoint(e.clientX, e.clientY);
    const nd = nearestNodeAt(sx, sy);
    if (!nd) return;
    svg.setPointerCapture(e.pointerId);
    if (!started) {
      started = true;
      current = nd;
      painting = true;
      render();
      setStatus("好的！现在沿着线拖到相邻的圆点～");
      return;
    }
    if (nd === current) { painting = true; return; }
    if (canStep(current, nd)) { painting = true; step(nd, sx, sy); return; }
    painting = true; // 允许从别处继续拖，move 时再判断
  });

  svg.addEventListener("pointermove", (e) => {
    if (!painting || solved || !started) return;
    const [sx, sy] = svgPoint(e.clientX, e.clientY);
    const nd = nearestNodeAt(sx, sy);
    if (nd && canStep(current, nd)) step(nd, sx, sy);
  });

  const end = (e) => { painting = false; if (e && e.pointerId != null) { try { svg.releasePointerCapture(e.pointerId); } catch (_) {} } };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("pointerleave", () => { painting = false; });
}

/* ---------- 胜负 / 提示 ---------- */
function checkWin() {
  if (drawn.size === level.total) {
    solved = true;
    painting = false;
    boardCard.classList.add("solved");
    setStatus("一笔画成！🎉", "ok");
    for (const k of level.nodes) sparkleAt(k);
    clearTimeout(praiseTimer);
    praiseTimer = setTimeout(showPraise, 1200);
  } else {
    setStatus(`已画 ${drawn.size} / ${level.total} 条`);
    let hasMove = false;
    for (const k of level.nodes) { if (canStep(current, k)) { hasMove = true; break; } }
    if (started && !hasMove) {
      setStatus(`走不通啦（已画 ${drawn.size}/${level.total}）—— 试试「撤销」或「重来」`, "warn");
    }
  }
}

function hint() {
  if (solved) return;
  if (!started) {
    const starts = validStarts(level.edges);
    if (!starts.length) { setStatus("这个图没法一笔画成～", "warn"); return; }
    flashStartNodes(starts);
    setStatus(starts.length <= 2 ? "从闪烁的圆点开始最稳妥～" : "这个图任意圆点都能开始哦～");
    return;
  }
  const remaining = level.edges.filter((e) => !drawn.has(e.id));
  const trail = eulerTrailEdges(remaining, current);
  if (trail && trail.length) {
    flashEdge(trail[0].id);
    setStatus("沿着闪烁的那条线走～");
  } else {
    setStatus("当前这步走不通了，撤销几步再试试～", "warn");
  }
}

function flashStartNodes(starts) {
  for (const k of starts) {
    const [x, y] = parseNode(k);
    const c = el("circle", { cx: px(x), cy: py(y), r: 11, class: "node-hint" });
    gFx.appendChild(c);
    setTimeout(() => c.remove(), 1400);
  }
}
function flashEdge(id) {
  const shape = gEdges.querySelector(`[data-id="${id}"]`);
  if (shape) {
    shape.classList.add("hint-flash");
    setTimeout(() => shape.classList.remove("hint-flash"), 1400);
  }
}

/* ---------- 流程 ---------- */
function loadLevel(i) {
  idx = Math.max(0, i);
  if (idx >= pool.length) pool.push(randomLevel());
  level = pool[idx];
  resetState();
  const label = idx < CLASSIC.length ? `第 ${idx + 1} 图 · ${level.name}` : `第 ${idx + 1} 图 · 随机`;
  levelNameEl.textContent = label;
  buildBoard();
  const starts = validStarts(level.edges).length;
  setStatus(starts <= 2 && starts > 0 ? "提示：要从特定的点起笔哦，点「提示」看看～" : "从任意一个圆点开始，沿着线一笔连下去～");
}

function resetState() {
  drawn = new Set();
  order = [];
  started = false;
  current = null;
  painting = false;
  solved = false;
  clearTimeout(praiseTimer);
  if (boardCard) boardCard.classList.remove("solved");
  hidePraise();
}

function restart() { resetState(); render(); setStatus("重来啦，从一个圆点开始～"); }

function undo() {
  if (solved || !order.length) return;
  const id = order.pop();
  drawn.delete(id);
  const e = level.byId.get(id);
  // 撤销后笔尖回到这条边的另一端（也就是上一步所在的点）
  current = (e.b === current) ? e.a : e.b;
  if (!order.length) { started = false; current = null; }
  render();
  checkWin();
}

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (cls ? " " + cls : "");
}

function showPraise() {
  praiseText.textContent = randomPraise();
  praiseModal.classList.remove("hidden");
}
function hidePraise() { if (praiseModal) praiseModal.classList.add("hidden"); }

/* ---------- 初始化 ---------- */
function init() {
  board = document.getElementById("board");
  statusEl = document.getElementById("status");
  levelNameEl = document.getElementById("levelName");
  boardCard = document.getElementById("boardCard");
  praiseModal = document.getElementById("praiseModal");
  praiseText = document.getElementById("praiseText");

  document.getElementById("prevBtn").addEventListener("click", () => { if (idx > 0) loadLevel(idx - 1); });
  document.getElementById("nextBtn").addEventListener("click", () => loadLevel(idx + 1));
  document.getElementById("randomBtn").addEventListener("click", () => { pool.push(randomLevel()); loadLevel(pool.length - 1); });
  document.getElementById("undoBtn").addEventListener("click", undo);
  document.getElementById("restartBtn").addEventListener("click", restart);
  document.getElementById("hintBtn").addEventListener("click", hint);
  document.getElementById("praiseClose").addEventListener("click", () => { hidePraise(); loadLevel(idx + 1); });
  praiseModal.addEventListener("click", (e) => { if (e.target === praiseModal) hidePraise(); });

  loadLevel(0);
}

document.addEventListener("DOMContentLoaded", init);
