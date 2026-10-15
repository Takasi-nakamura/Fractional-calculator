(() => {
  'use strict';

  /* ---------- 定数 ---------- */

  const LIMIT = { w: 99, n: 9999, d: 9999 };
  const FIELD = { w: '整数部', n: '分子', d: '分母' };
  const MAX_TERMS = 8;

  const OP_LABEL = { '+': '+', '-': '−', '*': '×', '/': '÷' };
  const OP_OPTIONS = [
    { v: '+', l: '+', s: '足す' },
    { v: '-', l: '−', s: '引く' },
    { v: '*', l: '×', s: 'かける' },
    { v: '/', l: '÷', s: '割る' }
  ];
  const MODE_OPTIONS = [
    { v: 'reduced', l: '約分', s: '2/4 → 1/2' },
    { v: 'improper', l: '分数', s: '約分しない形' },
    { v: 'mixed', l: '帯分数', s: '5/3 → 1 2/3' }
  ];

  /* ---------- 状態 ---------- */

  const state = {
    terms: [
      { w: 0, n: 1, d: 2 },
      { w: 0, n: 1, d: 3 }
    ],
    ops: ['+'],
    sel: { t: 0, f: 'n' },
    mode: 'reduced'
  };

  /* ---------- DOM ---------- */

  const $ = s => document.querySelector(s);
  const editorEl = $('#editor');
  const formulaEl = $('#formula');
  const formulaCard = $('#formulaCard');
  const modeLabel = $('#modeLabel');
  const keypadLabel = $('#keypadLabel');
  const removeBtn = $('#removeBtn');
  const dropdown = $('#dropdown');

  /* ---------- 分数の計算（BigInt） ---------- */

  class CalcError extends Error {}

  const gcd = (a, b) => {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b) [a, b] = [b, a % b];
    return a;
  };

  // 分母は常に正に保つ。0は計算エラー
  const frac = (n, d) => {
    if (d === 0n) throw new CalcError('分母が0になっています');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    return { n, d };
  };

  const reduce = f => {
    if (f.d === 0n) return f;
    const g = gcd(f.n, f.d);
    const n = f.n / g;
    const d = f.d / g;
    return n === 0n ? { n: 0n, d: 1n } : { n, d };
  };

  // 入力（帯分数）→ 仮分数（約分前）。検証なし（表示用）
  const rawTerm = t => {
    const d = BigInt(t.d);
    return { n: BigInt(t.w) * d + BigInt(t.n), d };
  };

  // 入力 → 計算用（0分母はエラー）
  const toFrac = t => {
    const r = rawTerm(t);
    return frac(r.n, r.d);
  };

  const add = (a, b) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
  const sub = (a, b) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
  const mul = (a, b) => frac(a.n * b.n, a.d * b.d);
  const div = (a, b) => {
    if (b.n === 0n) throw new CalcError('0で割ることはできません');
    return frac(a.n * b.d, a.d * b.n);
  };

  // 四則演算の優先順位（× ÷ → + −）を守って評価
  const evaluate = () => {
    const vals = state.terms.map(toFrac);
    const stack = [vals[0]];
    const addOps = [];

    state.ops.forEach((op, i) => {
      const b = vals[i + 1];
      if (op === '*' || op === '/') {
        const a = stack.pop();
        stack.push(op === '*' ? mul(a, b) : div(a, b));
      } else {
        addOps.push(op);
        stack.push(b);
      }
    });

    let r = stack[0];
    addOps.forEach((op, i) => {
      const b = stack[i + 1];
      r = op === '+' ? add(r, b) : sub(r, b);
    });
    return r;
  };

  /* ---------- 表示用DOM ---------- */

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const txt = (s, cls) => el('span', cls || '', s);
  const sign = big => big.toString().replace('-', '−');

  const fracNode = (n, d) => {
    const w = el('span', 'frac');
    w.append(
      el('span', 'frac-num', sign(n)),
      el('span', 'frac-bar'),
      el('span', 'frac-den', d.toString())
    );
    return w;
  };

  // mode: 'reduced'（約分） / 'improper'（分数・約分しない） / 'mixed'（帯分数）
  const valueNode = (f, mode) => {
    if (f.d === 0n) return fracNode(f.n, f.d);

    if (mode === 'improper') {
      return f.d === 1n ? txt(sign(f.n)) : fracNode(f.n, f.d);
    }

    const r = reduce(f);
    if (mode === 'reduced') {
      return r.d === 1n ? txt(sign(r.n)) : fracNode(r.n, r.d);
    }

    // mixed
    const neg = r.n < 0n;
    const a = neg ? -r.n : r.n;
    const whole = a / r.d;
    const rem = a % r.d;

    if (rem === 0n) {
      return txt((neg ? '−' : '') + whole.toString());
    }

    const wrap = el('span', 'mixed');
    if (neg) wrap.append(txt('−'));
    if (whole > 0n) wrap.append(txt(whole.toString(), 'wpart'));
    wrap.append(fracNode(rem, r.d));
    return wrap;
  };

  /* ---------- 描画 ---------- */

  function cellBtn(text, extraCls, t, f) {
    const b = el('button', extraCls, text);
    b.type = 'button';
    if (state.sel.t === t && state.sel.f === f) b.classList.add('sel');
    b.setAttribute('aria-label', `${t + 1}つ目の${FIELD[f]}`);
    b.addEventListener('click', () => {
      state.sel = { t, f };
      update();
    });
    return b;
  }

  function termEditor(t, i) {
    const wrap = el('div', 'term');
    const whole = cellBtn(String(t.w), 'whole', i, 'w');

    const fe = el('div', 'fe');
    const num = cellBtn(String(t.n), '', i, 'n');
    const bar = el('div', 'frac-bar');
    const den = cellBtn(String(t.d), t.d === 0 ? 'err' : '', i, 'd');
    fe.append(num, bar, den);

    wrap.append(whole, fe);
    return wrap;
  }

  function renderEditor() {
    editorEl.replaceChildren();

    state.terms.forEach((t, i) => {
      if (i > 0) {
        const opIndex = i - 1;
        const b = el('button', 'op', OP_LABEL[state.ops[opIndex]]);
        b.type = 'button';
        b.setAttribute('aria-label', '演算子');
        b.addEventListener('click', () => {
          openDropdown(b, OP_OPTIONS, state.ops[opIndex], v => {
            state.ops[opIndex] = v;
            update();
          });
        });
        editorEl.append(b);
      }
      editorEl.append(termEditor(t, i));
    });

    if (state.terms.length < MAX_TERMS) {
      const add = el('button', 'add', '+');
      add.type = 'button';
      add.setAttribute('aria-label', '項を追加');
      add.addEventListener('click', addTerm);
      editorEl.append(add);
    }
  }

  function renderFormula() {
    formulaEl.replaceChildren();

    state.terms.forEach((t, i) => {
      if (i > 0) formulaEl.append(txt(OP_LABEL[state.ops[i - 1]], 'op-sym'));
      formulaEl.append(valueNode(rawTerm(t), state.mode));
    });
    formulaEl.append(txt('=', 'op-sym'));

    try {
      formulaEl.append(valueNode(evaluate(), state.mode));
    } catch (err) {
      const msg = err instanceof CalcError ? err.message : '計算できません';
      formulaEl.append(el('span', 'err-text', msg));
    }
  }

  function renderKeypadLabel() {
    keypadLabel.textContent = `選択中：${state.sel.t + 1}つ目の${FIELD[state.sel.f]}`;
  }

  function update() {
    renderEditor();
    renderFormula();
    renderKeypadLabel();
    modeLabel.textContent = MODE_OPTIONS.find(m => m.v === state.mode).l;
    removeBtn.disabled = state.terms.length <= 2;
  }

  /* ---------- 入力操作 ---------- */

  const currentTerm = () => state.terms[state.sel.t];

  function setDigit(dg) {
    const t = currentTerm();
    const f = state.sel.f;
    const next = t[f] * 10 + dg;
    if (next > LIMIT[f]) return;
    t[f] = next;
    update();
  }

  function backspace() {
    const t = currentTerm();
    const f = state.sel.f;
    t[f] = Math.floor(t[f] / 10);
    update();
  }

  function clearField() {
    currentTerm()[state.sel.f] = 0;
    update();
  }

  function nextField(dir) {
    const list = [];
    state.terms.forEach((_, i) => {
      ['w', 'n', 'd'].forEach(f => list.push({ t: i, f }));
    });
    const idx = list.findIndex(x => x.t === state.sel.t && x.f === state.sel.f);
    state.sel = list[(idx + dir + list.length) % list.length];
    update();
  }

  function addTerm() {
    if (state.terms.length >= MAX_TERMS) return;
    state.ops.push('+');
    state.terms.push({ w: 0, n: 0, d: 1 });
    state.sel = { t: state.terms.length - 1, f: 'n' };
    update();
  }

  function removeTerm() {
    if (state.terms.length <= 2) return;
    state.terms.pop();
    state.ops.pop();
    if (state.sel.t >= state.terms.length) {
      state.sel = { t: state.terms.length - 1, f: 'n' };
    }
    update();
  }

  function handleKey(k) {
    if (/^\d$/.test(k)) setDigit(Number(k));
    else if (k === 'C') clearField();
    else if (k === 'BS') backspace();
    else if (k === 'NEXT') nextField(1);
  }

  /* ---------- ドロップダウン ---------- */

  let ddAnchor = null;

  function openDropdown(anchor, options, current, onPick) {
    ddAnchor = anchor;
    dropdown.replaceChildren();

    options.forEach(o => {
      const b = el('button', 'dd-item');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.append(el('span', '', o.l));
      if (o.s) b.append(el('small', '', o.s));
      if (o.v === current) {
        b.classList.add('active');
        b.setAttribute('aria-selected', 'true');
      }
      b.addEventListener('click', e => {
        e.stopPropagation();
        closeDropdown();
        onPick(o.v);
      });
      dropdown.append(b);
    });

    dropdown.hidden = false;
    placeDropdown(anchor);
  }

  function placeDropdown(anchor) {
    const r = anchor.getBoundingClientRect();
    const dw = dropdown.offsetWidth;
    const dh = dropdown.offsetHeight;
    const sx = window.scrollX;
    const sy = window.scrollY;
    const vw = document.documentElement.clientWidth;

    let left = r.left + sx;
    left = Math.max(sx + 12, Math.min(left, sx + vw - dw - 12));

    let top = r.bottom + sy + 8;
    if (r.bottom + dh + 12 > window.innerHeight && r.top > dh + 12) {
      top = r.top + sy - dh - 8;
    }

    dropdown.style.left = `${left}px`;
    dropdown.style.top = `${top}px`;
  }

  function closeDropdown() {
    dropdown.hidden = true;
    ddAnchor = null;
  }

  /* ---------- イベント ---------- */

  removeBtn.addEventListener('click', removeTerm);

  document.querySelectorAll('[data-key]').forEach(b => {
    b.addEventListener('click', () => handleKey(b.dataset.key));
  });

  formulaCard.addEventListener('click', () => {
    openDropdown(formulaCard, MODE_OPTIONS, state.mode, v => {
      state.mode = v;
      update();
    });
  });

  formulaCard.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      formulaCard.click();
    }
  });

  document.addEventListener('pointerdown', e => {
    if (dropdown.hidden) return;
    if (dropdown.contains(e.target)) return;
    if (ddAnchor && ddAnchor.contains(e.target)) return;
    closeDropdown();
  });

  window.addEventListener('resize', closeDropdown);

  // キーボード対応（PC）
  document.addEventListener('keydown', e => {
    if (!dropdown.hidden) {
      if (e.key === 'Escape') closeDropdown();
      return;
    }
    if (e.target === formulaCard) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nextField(-1);
      return;
    }

    let k = null;
    if (/^\d$/.test(e.key)) k = e.key;
    else if (e.key === 'Backspace') k = 'BS';
    else if (e.key === 'Delete') k = 'C';
    else if (e.key === 'Enter' || e.key === 'ArrowRight') k = 'NEXT';

    if (k) {
      e.preventDefault();
      handleKey(k);
    }
  });

  update();
})();
