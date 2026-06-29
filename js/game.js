"use strict";

/* ============================================================
   一笔画 (One-Stroke / Eulerian path)
   - 图 = 节点(圆点) + 边(线)。玩家从一个点出发，沿着边一笔连下去，
     每条边走且只走一次，把所有边走完即通关。
   - 经典关卡手工定义；随机关卡用「随机闭合走线」构造，天然可解、无非节点交叉。
   - 欧拉算法(Hierholzer)用于：校验可解、计算合法起点、提示下一步。
   ============================================================ */

const SVGNS = "http://www.w3.org/2000/svg";

/* 画布：以格点(lattice)为坐标，x ∈ [0..COLS], y ∈ [0..ROWS] */
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

/* 把一串坐标对 [[x1,y1,x2,y2], ...] 变成 level 对象 */
function makeLevel(name, segs) {
  const edges = new Set();
  for (const [x1, y1, x2, y2] of segs) edges.add(ekeyXY(x1, y1, x2, y2));
  return makeLevelFromKeys(name, [...edges]);
}
function makeLevelFromKeys(name, edgeKeys) {
  const edges = new Set(edgeKeys);
  const nodes = new Set();
  for (const ek of edges) { const [a, b] = ek.split("|"); nodes.add(a); nodes.add(b); }
  return { name, edges, nodes, total: edges.size };
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
   欧拉算法（Hierholzer）
   ============================================================ */
function degreeMap(edgeKeys) {
  const deg = new Map();
  for (const ek of edgeKeys) {
    const [a, b] = ek.split("|");
    deg.set(a, (deg.get(a) || 0) + 1);
    deg.set(b, (deg.get(b) || 0) + 1);
  }
  return deg;
}
function oddNodes(edgeKeys) {
  const deg = degreeMap(edgeKeys);
  const odd = [];
  for (const [k, d] of deg) if (d % 2 === 1) odd.push(k);
  return odd;
}
/* 合法起点：恰好 2 个奇数点 → 那 2 个；全偶数 → 任意点 */
function validStarts(edgeKeys) {
  const odd = oddNodes(edgeKeys);
  if (odd.length === 2) return odd;
  if (odd.length === 0) {
    const deg = degreeMap(edgeKeys);
    return [...deg.keys()];
  }
  return []; // 不可一笔画成
}
/* 从 start 出发，返回经过所有边各一次的节点序列；不存在则返回 null */
function eulerTrail(edgeKeys, start) {
  const total = edgeKeys.length;
  if (total === 0) return null;
  const adj = new Map();
  const add = (a, b, ek) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push([b, ek]); };
  for (const ek of edgeKeys) { const [a, b] = ek.split("|"); add(a, b, ek); add(b, a, ek); }
  if (!adj.has(start)) return null;

  const used = new Set();
  const ptr = new Map();
  const stack = [start];
  const out = [];
  while (stack.length) {
    const v = stack[stack.length - 1];
    const list = adj.get(v) || [];
    let advanced = false;
    while ((ptr.get(v) || 0) < list.length) {
      const i = ptr.get(v) || 0; ptr.set(v, i + 1);
      const [w, ek] = list[i];
      if (used.has(ek)) continue;
      used.add(ek); stack.push(w); advanced = true; break;
    }
    if (!advanced) out.push(stack.pop());
  }
  if (used.size !== total) return null;
  out.reverse();
  return out.length === total + 1 ? out : null;
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

let drawn = new Set();     // 已画边的 key
let order = [];            // 已画边的顺序
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

function render() {
  gEdges.innerHTML = "";
  gNodes.innerHTML = "";

  const orderIndex = new Map();
  order.forEach((ek, i) => orderIndex.set(ek, i));

  // 边
  for (const ek of level.edges) {
    const [a, b] = ek.split("|");
    const [x1, y1] = parseNode(a);
    const [x2, y2] = parseNode(b);
    const line = el("line", { x1: px(x1), y1: py(y1), x2: px(x2), y2: py(y2) });
    if (drawn.has(ek)) {
      const i = orderIndex.get(ek) || 0;
      const hue = (i / Math.max(1, level.total)) * 300;
      line.setAttribute("class", "edge-done");
      line.setAttribute("stroke", `hsl(${hue}, 80%, 52%)`);
    } else {
      line.setAttribute("class", "edge");
    }
    gEdges.appendChild(line);
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

/* ---------- 交互 ---------- */
function nearestNode(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const scale = W / rect.width;
  const sx = (clientX - rect.left) * scale;
  const sy = (clientY - rect.top) * scale;
  let best = null, bestD = SNAP * SNAP;
  for (const k of level.nodes) {
    const [x, y] = parseNode(k);
    const dx = px(x) - sx, dy = py(y) - sy;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

function canStep(from, to) {
  if (from === to) return false;
  const ek = ekey(from, to);
  return level.edges.has(ek) && !drawn.has(ek);
}

function step(to) {
  const ek = ekey(current, to);
  drawn.add(ek);
  order.push(ek);
  current = to;
  render();
  checkWin();
}

function bindDrawing() {
  svg.addEventListener("pointerdown", (e) => {
    if (solved) return;
    const nd = nearestNode(e.clientX, e.clientY);
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
    if (canStep(current, nd)) { painting = true; step(nd); return; }
    painting = true; // 允许从别处继续拖，move 时再判断
  });

  svg.addEventListener("pointermove", (e) => {
    if (!painting || solved || !started) return;
    const nd = nearestNode(e.clientX, e.clientY);
    if (nd && canStep(current, nd)) step(nd);
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
    // 走不通的提醒：当前点已无可走的边，但还没画完
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
    const starts = validStarts([...level.edges]);
    if (!starts.length) { setStatus("这个图没法一笔画成～", "warn"); return; }
    flashStartNodes(starts);
    setStatus(starts.length <= 2 ? "从闪烁的圆点开始最稳妥～" : "这个图任意圆点都能开始哦～");
    return;
  }
  const remaining = [...level.edges].filter((e) => !drawn.has(e));
  const trail = eulerTrail(remaining, current);
  if (trail && trail.length >= 2) {
    flashEdge(ekey(trail[0], trail[1]));
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
function flashEdge(ek) {
  for (const line of gEdges.querySelectorAll("line")) {
    const [x1, y1] = [Number(line.getAttribute("x1")), Number(line.getAttribute("y1"))];
    const [x2, y2] = [Number(line.getAttribute("x2")), Number(line.getAttribute("y2"))];
    const a = nkey((x1 - PAD) / CS, (y1 - PAD) / CS);
    const b = nkey((x2 - PAD) / CS, (y2 - PAD) / CS);
    if (ekey(a, b) === ek) {
      line.classList.add("hint-flash");
      setTimeout(() => line.classList.remove("hint-flash"), 1400);
    }
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
  const starts = validStarts([...level.edges]).length;
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
  const ek = order.pop();
  drawn.delete(ek);
  const [a, b] = ek.split("|");
  // 撤销后笔尖回到这条边的另一端（也就是上一步所在的点）
  current = (b === current) ? a : b;
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
