/* dsh-highlighter — Browser side (client bundle)
 *
 * DeepSeek Harness in-page text highlight & annotation plugin:
 *   - Select text -> Floating toolbar (3 quick colors + 8-color palette + tag + copy)
 *   - Click highlighted text -> Management toolbar (change color / write note / add tag / copy / delete)
 *   - Right-side dot rail: one dot per highlight, matching the highlight color;
 *     dots are arranged from top to bottom by document context position (higher highlights on top, lower below),
 *     with vertical position proportionally mapped to content height. Click dot to smoothly scroll and flash highlight.
 *   - Persistence in localStorage (dshhl_highlights), re-anchored across React re-renders
 *     via text + surrounding context matching (MutationObserver).
 *
 * Bundle format: window.__ModuleLoader__.load({ id, factory }),
 * factory returns Cordis plugin { apply, inject }.
 */
window.__ModuleLoader__.load({
	id: "dsh-highlighter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const INSTANCE_VERSION = "1.0.0";
		const STORE_KEY = "dshhl_highlights";
		const CLASS = "dsh-hl"; // Highlight span class name
		const ID_ATTR = "data-dsh-id"; // Record ID attribute on highlight span

		// 8 classic highlight colors
		const COLORS = {
			red: "#F6A6A6",
			orange: "#FFCC80",
			yellow: "#FFF176",
			green: "#B9F6CA",
			teal: "#69F0D8",
			blue: "#A8D8FF",
			purple: "#D3B0FF",
			pink: "#FFB3DE"
		};
		const COLOR_NAMES = {
			red: "Red", orange: "Orange", yellow: "Yellow", green: "Green",
			teal: "Teal", blue: "Blue", purple: "Purple", pink: "Pink"
		};
		const QUICK = ["red", "yellow", "blue"]; // 3 quick colors on selection
		const DEFAULT_COLOR = "yellow"; // Default color when tagging an unhighlighted selection

		if (window.__dshHighlighterLoaded && window.__dshHighlighterVersion === INSTANCE_VERSION) {
			exports.apply = () => {};
			exports.inject = [];
			return module.exports;
		}
		window.__dshHighlighterLoaded = true;
		window.__dshHighlighterVersion = INSTANCE_VERSION;

		/* ── Lifecycle & Timer Registry ──────────────────────── */
		const timers = new Set();
		function later(fn, ms) {
			const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
			timers.add(t);
			return t;
		}

		/* ── Storage ─────────────────────────────────────────── */
		const store = new Map();
		let seq = 0;
		const uid = () => "h" + Date.now().toString(36) + (seq++).toString(36);
		let saveTimer = null;

		function save() {
			clearTimeout(saveTimer);
			saveTimer = setTimeout(() => {
				try {
					localStorage.setItem(STORE_KEY, JSON.stringify([...store.values()]));
				} catch (e) { /* Silently fallback to memory-only when storage is unavailable */ }
			}, 200);
		}
		function loadRecords() {
			try {
				const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
				if (!Array.isArray(parsed)) return [];
				return parsed.filter((r) => r && typeof r.id === "string" && typeof r.text === "string");
			} catch (e) { return []; }
		}

		/* ── Page Styles & UI Host (Shadow DOM isolates DSH styles) ── */
		let pageStyle = null;
		function ensureStyle() {
			if (pageStyle && pageStyle.isConnected) return pageStyle;
			pageStyle = document.createElement("style");
			pageStyle.setAttribute("data-plugin", "dsh-highlighter");
			pageStyle.textContent = `
				span.${CLASS} {
					cursor: pointer; border-radius: 2px; padding: 0 1px;
					box-decoration-break: clone; -webkit-box-decoration-break: clone;
					transition: filter .12s ease, box-shadow .2s ease;
				}
				span.${CLASS}:hover { filter: brightness(0.94); }
			`;
			(document.head || document.documentElement).appendChild(pageStyle);
			return pageStyle;
		}

		let host = null;
		let shadow = null;
		let uiRoot = null;
		let railEl = null;
		const dotMap = new Map(); // id -> dot element

		function ensureHost() {
			if (host && host.isConnected) return;
			host = document.createElement("div");
			host.id = "dsh-highlighter-host";
			host.style.cssText = "all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647; width: 0; height: 0;";
			shadow = host.attachShadow({ mode: "open" });
			shadow.innerHTML = `
			<style>
				* { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
				.toolbar { position: fixed; display: flex; align-items: center; gap: 6px; background: #fff; border-radius: 22px;
					padding: 6px 10px; box-shadow: 0 4px 16px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.05); animation: dshpop .12s ease; z-index: 2147483647; }
				@keyframes dshpop { from { transform: scale(.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
				.dot { width: 18px; height: 18px; border-radius: 50%; cursor: pointer; border: none;
					box-shadow: inset 0 0 0 1px rgba(0,0,0,.08); transition: transform .1s ease; }
				.dot:hover { transform: scale(1.25); }
				.ibtn { width: 26px; height: 26px; border-radius: 50%; border: none; background: transparent;
					display: flex; align-items: center; justify-content: center; cursor: pointer; color: #555; }
				.ibtn:hover { background: #f0f0f0; color: #111; }
				.ibtn svg { width: 15px; height: 15px; }
				.sep { width: 1px; height: 16px; background: #e5e5e5; }
				.popup { position: fixed; background: #fff; border-radius: 14px; box-shadow: 0 8px 30px rgba(0,0,0,.2), 0 0 0 1px rgba(0,0,0,.05); animation: dshpop .12s ease; z-index: 2147483647; }
				.palette { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 12px; border-radius: 22px; max-width: 220px; }
				.note-card { width: 280px; padding: 14px; display: flex; flex-direction: column; }
				.note-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
				.note-title { font-size: 14px; font-weight: 600; color: #222; }
				.note-close { width: 24px; height: 24px; border: none; background: transparent; cursor: pointer; color: #999; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
				.note-close:hover { background: #f0f0f0; color: #333; }
				.note-area { width: 100%; min-height: 110px; border: none; outline: none; resize: none; font-size: 13px; color: #333; line-height: 1.6; background: transparent; }
				.note-area::placeholder { color: #bbb; }
				.note-foot { display: flex; justify-content: flex-end; margin-top: 6px; }
				.send { width: 30px; height: 30px; border-radius: 50%; border: none; background: #f5f5f5; cursor: pointer; color: #666; display: flex; align-items: center; justify-content: center; }
				.send:hover { background: #FFE14D; color: #333; }
				.tag-card { width: 300px; padding: 18px 16px 14px; }
				.tag-input { width: 100%; border: none; border-bottom: 1px solid #ddd; outline: none; font-size: 14px; color: #333; padding: 4px 2px 8px; background: transparent; }
				.tag-input::placeholder { color: #bbb; }
				.tag-input:focus { border-bottom-color: #FFD900; }
				.tag-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; min-height: 0; }
				.chip { display: inline-flex; align-items: center; gap: 5px; background: #f5f5f5; color: #444;
					border-radius: 10px; padding: 2px 8px; font-size: 12px; }
				.chip-x { border: none; background: transparent; color: #999; cursor: pointer; font-size: 12px; padding: 0 2px; border-radius: 50%; }
				.chip-x:hover { color: #c0392b; }
				.tag-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
				.btn { border: none; border-radius: 16px; padding: 6px 18px; font-size: 13px; cursor: pointer; }
				.btn-cancel { background: transparent; color: #666; } .btn-cancel:hover { background: #f3f3f3; }
				.btn-ok { background: #FFD900; color: #222; font-weight: 500; } .btn-ok:hover { filter: brightness(.96); }
				.tip { position: fixed; max-width: 300px; background: #fff; border-radius: 12px; padding: 10px 14px;
					box-shadow: 0 6px 24px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.05); font-size: 13px; color: #333;
					line-height: 1.6; z-index: 2147483647; animation: dshpop .12s ease; pointer-events: none; word-break: break-word; }
				.tip .t-tag { display: inline-block; background: #f5f5f5; color: #555; border-radius: 10px; padding: 1px 10px; margin: 2px 4px 2px 0; font-size: 12px; }
				.tip .t-note { color: #444; white-space: pre-wrap; }
				.toast { position: fixed; background: rgba(30,30,30,.85); color: #fff; font-size: 12px; border-radius: 14px; padding: 5px 14px; z-index: 2147483647; animation: dshpop .12s ease; }
				.rail {
					position: fixed; right: 10px; top: 50%; transform: translateY(-50%);
					width: 22px; height: min(60vh, 480px);
					display: none; flex-direction: column; align-items: center;
					padding: 8px 0; pointer-events: none;
				}
				.dot-item {
					position: absolute; left: 50%; transform: translate(-50%, -50%);
					width: 12px; height: 12px; border-radius: 50%; cursor: pointer; pointer-events: auto;
					box-shadow: 0 0 0 2px rgba(255,255,255,.95), 0 1px 3px rgba(0,0,0,.28);
					transition: transform .12s ease; flex-shrink: 0;
				}
				.dot-item:hover { transform: translate(-50%, -50%) scale(1.5); }
				.dot-item.dsh-flash { animation: dshring .7s ease; }
				@keyframes dshring {
					0% { box-shadow: 0 0 0 2px rgba(255,255,255,.95), 0 0 0 0 rgba(80,140,255,.65); }
					100% { box-shadow: 0 0 0 2px rgba(255,255,255,.95), 0 0 0 10px rgba(80,140,255,0); }
				}
			</style>
			<div id="root"></div>`;
			uiRoot = shadow.getElementById("root");
			(document.body || document.documentElement).appendChild(host);
		}

		/* ── DOM Utilities ─────────────────────────────────────── */
		const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
		const ICONS = {
			palette: `<svg viewBox="0 0 24 24" width="15" height="15"><rect x="3" y="9" width="8" height="8" rx="1.5" fill="${COLORS.yellow}" stroke="#888" stroke-width="1"/><rect x="8" y="6" width="8" height="8" rx="1.5" fill="${COLORS.teal}" stroke="#888" stroke-width="1"/><rect x="13" y="10" width="8" height="8" rx="1.5" fill="${COLORS.red}" stroke="#888" stroke-width="1"/></svg>`,
			note: svg('<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.8.6 1.5 1.6 1.5 2.6V17h4v-.5c0-1 .7-2 1.5-2.6A6 6 0 0 0 12 3z"/>'),
			tag: svg('<path d="M20.6 13.4 11 3.8A2 2 0 0 0 9.6 3.2H4a1 1 0 0 0-1 1v5.6c0 .5.2 1 .6 1.4l9.6 9.6a2 2 0 0 0 2.8 0l4.6-4.6a2 2 0 0 0 0-2.8z"/><circle cx="7.5" cy="7.5" r="1" fill="currentColor"/>'),
			copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
			trash: svg('<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>'),
			close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
			send: svg('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>')
		};

		function h(tag, props = {}, children = []) {
			const el = document.createElement(tag);
			for (const [k, v] of Object.entries(props)) {
				if (k === "class") el.className = v;
				else if (k === "html") el.innerHTML = v;
				else if (k === "style") el.style.cssText = v;
				else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
				else el.setAttribute(k, v);
			}
			for (const c of children) el.appendChild(c);
			return el;
		}

		function placeFixed(el, rect, preferAbove = true) {
			el.style.visibility = "hidden";
			uiRoot.appendChild(el);
			const w = el.offsetWidth, hh = el.offsetHeight;
			let left = rect.left + rect.width / 2 - w / 2;
			left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
			let top = preferAbove ? rect.top - hh - 10 : rect.bottom + 10;
			if (top < 8) top = rect.bottom + 10;
			if (top + hh > window.innerHeight - 8) top = Math.max(8, rect.top - hh - 10);
			el.style.left = left + "px";
			el.style.top = top + "px";
			el.style.visibility = "visible";
		}
		function hideUI() {
			if (!uiRoot) return;
			Array.from(uiRoot.children).forEach((c) => { if (c !== railEl) c.remove(); });
		}
		function toast(text, rect) {
			const t = h("div", { class: "toast" }, [document.createTextNode(text)]);
			placeFixed(t, rect, false);
			later(() => t.remove(), 1200);
		}

		/* ── Selection Wrapping / Unwrapping ──────────────────── */
		function textNodesIn(range) {
			const nodes = [];
			const root = range.commonAncestorContainer.nodeType === 1
				? range.commonAncestorContainer
				: range.commonAncestorContainer.parentNode;
			if (!root) return nodes;
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
				acceptNode(n) {
					if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
					try { return range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
					catch (e) { return NodeFilter.FILTER_REJECT; }
				}
			});
			let n;
			while ((n = walker.nextNode())) nodes.push(n);
			return nodes;
		}
		function wrapRange(range, id, color) {
			const spans = [];
			for (const node of textNodesIn(range)) {
				if (!node.isConnected) continue;
				const start = (node === range.startContainer) ? range.startOffset : 0;
				const end = (node === range.endContainer) ? range.endOffset : node.nodeValue.length;
				if (start >= end) continue;
				let target = node;
				if (start > 0) target = node.splitText(start);
				if (end - start < target.nodeValue.length) target.splitText(end - start);
				const span = document.createElement("span");
				span.className = CLASS;
				span.setAttribute(ID_ATTR, id);
				span.style.backgroundColor = COLORS[color] || color;
				target.parentNode.replaceChild(span, target);
				span.appendChild(target);
				spans.push(span);
			}
			return spans;
		}
		function unwrap(id) {
			document.querySelectorAll(`span.${CLASS}[${ID_ATTR}="${id}"]`).forEach((span) => {
				const parent = span.parentNode;
				while (span.firstChild) parent.insertBefore(span.firstChild, span);
				parent.removeChild(span);
				parent.normalize();
			});
		}
		function contextAround(range) {
			let prefix = "", suffix = "";
			if (range.startContainer.nodeType === 3) prefix = range.startContainer.nodeValue.slice(Math.max(0, range.startOffset - 32), range.startOffset);
			if (range.endContainer.nodeType === 3) suffix = range.endContainer.nodeValue.slice(range.endOffset, range.endOffset + 32);
			return { prefix, suffix };
		}
		function selectionInEditable() {
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0) return false;
			let node = sel.anchorNode;
			if (node && node.nodeType === 3) node = node.parentNode;
			return !!(node && node.closest && node.closest("input, textarea, select, [contenteditable]"));
		}

		/* ── Re-anchoring: Full-text indexing + text/context matching ── */
		function buildTextIndex() {
			const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
				acceptNode(n) {
					const p = n.parentNode;
					if (!p) return NodeFilter.FILTER_REJECT;
					const tag = p.nodeName.toLowerCase();
					if (tag === "script" || tag === "style" || tag === "noscript" || tag === "textarea") return NodeFilter.FILTER_REJECT;
					if (p.closest && p.closest("#dsh-highlighter-host, input, select, [contenteditable]")) return NodeFilter.FILTER_REJECT;
					if (!n.nodeValue.length) return NodeFilter.FILTER_REJECT;
					return NodeFilter.FILTER_ACCEPT;
				}
			});
			const nodes = [];
			let full = "", n;
			while ((n = walker.nextNode())) {
				nodes.push({ node: n, start: full.length });
				full += n.nodeValue;
			}
			return { nodes, full };
		}
		function locateText(index, rec) {
			const { nodes, full } = index;
			if (!rec.text) return null;
			const hits = [];
			let i = full.indexOf(rec.text);
			while (i !== -1 && hits.length < 50) {
				hits.push(i);
				i = full.indexOf(rec.text, i + 1);
			}
			if (!hits.length) return null;
			let best = hits[0], bestScore = -1;
			for (const pos of hits) {
				let score = 0;
				if (rec.prefix && full.slice(Math.max(0, pos - rec.prefix.length), pos) === rec.prefix) score += 2;
				if (rec.suffix && full.slice(pos + rec.text.length, pos + rec.text.length + rec.suffix.length) === rec.suffix) score += 2;
				if (score > bestScore) { bestScore = score; best = pos; }
			}
			const endPos = best + rec.text.length;
			let sNode = null, sOff = 0, eNode = null, eOff = 0;
			for (const { node, start } of nodes) {
				const nodeEnd = start + node.nodeValue.length;
				if (sNode === null && best >= start && best < nodeEnd) { sNode = node; sOff = best - start; }
				if (endPos > start && endPos <= nodeEnd) { eNode = node; eOff = endPos - start; }
				if (sNode && eNode) break;
			}
			if (!sNode || !eNode) return null;
			const r = document.createRange();
			r.setStart(sNode, sOff);
			r.setEnd(eNode, eOff);
			return r;
		}
		function anchorAll() {
			if (!store.size) return;
			const index = buildTextIndex();
			for (const rec of store.values()) {
				if (document.querySelector(`span.${CLASS}[${ID_ATTR}="${rec.id}"]`)) continue;
				const range = locateText(index, rec);
				if (range) {
					try { wrapRange(range, rec.id, rec.color); } catch (e) { /* Skip snippets that cannot be wrapped */ }
				}
			}
		}

		/* ── Right-side Dot Rail (ordered by doc position + height mapping) ── */
		function findScrollContainer() {
			const sample = document.querySelector(`span.${CLASS}`) || document.body;
			let el = sample.parentElement;
			while (el && el !== document.documentElement) {
				const cs = getComputedStyle(el);
				if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && el.clientHeight > 100) return el;
				el = el.parentElement;
			}
			return document.scrollingElement || document.documentElement;
		}

		function buildRail() {
			const spans = document.querySelectorAll(`span.${CLASS}`);
			if (!spans.length) {
				if (railEl) railEl.style.display = "none";
				return;
			}
			ensureHost();
			if (!railEl) {
				railEl = h("div", { class: "rail" });
				uiRoot.appendChild(railEl);
			}
			railEl.style.display = "flex";

			// Take only the first span per record, sort in document order (top -> bottom)
			const first = new Map();
			spans.forEach((span) => {
				const id = span.getAttribute(ID_ATTR);
				if (id && !first.has(id)) first.set(id, span);
			});
			const entries = [...first.entries()];
			entries.sort((a, b) =>
				(a[1].compareDocumentPosition(b[1]) & Node.DOCUMENT_POSITION_FOLLOWING) ? 1 : -1
			);

			// Vertical position = proportional position of highlight in scroll content
			let sc = null, contentTop = 0, height = 1;
			try {
				sc = findScrollContainer();
				const scRect = sc.getBoundingClientRect();
				contentTop = scRect.top - sc.scrollTop;
				height = sc.scrollHeight || 1;
			} catch (e) { /* Fallback to even distribution if layout read fails */ }

			railEl.innerHTML = "";
			dotMap.clear();
			entries.forEach(([id, span], idx) => {
				const rec = store.get(id);
				if (!rec) return;
				let pct;
				try {
					const r = span.getBoundingClientRect();
					const y = r.top - contentTop + r.height / 2;
					pct = Math.min(96, Math.max(4, (y / height) * 100));
				} catch (e) {
					pct = 4 + (idx / Math.max(1, entries.length - 1)) * 88;
				}
				const dot = h("div", { class: "dot-item" });
				dot.setAttribute(ID_ATTR, id);
				dot.style.top = pct + "%";
				dot.style.backgroundColor = COLORS[rec.color] || rec.color;
				dot.title = (rec.note ? "💡 " + rec.note + "\n" : "") +
					(rec.tags && rec.tags.length ? "#" + rec.tags.join(" #") + "\n" : "") +
					rec.text;
				dot.addEventListener("click", (e) => {
					e.stopPropagation();
					jumpToHighlight(id);
				});
				railEl.appendChild(dot);
				dotMap.set(id, dot);
			});
		}
		let buildTimer = null;
		function scheduleRail() {
			clearTimeout(buildTimer);
			buildTimer = setTimeout(() => { try { buildRail(); } catch (e) { /* Skip rebuild during layout jitter */ } }, 30);
		}

		function jumpToHighlight(id) {
			const span = document.querySelector(`span.${CLASS}[${ID_ATTR}="${id}"]`);
			if (!span) return;
			const sc = findScrollContainer();
			const scRect = sc.getBoundingClientRect();
			const spanRect = span.getBoundingClientRect();
			const target = sc.scrollTop + (spanRect.top - scRect.top) - sc.clientHeight / 2 + spanRect.height / 2;
			sc.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
			// Flash corresponding highlight to indicate location
			try {
				span.style.boxShadow = "0 0 0 3px rgba(80,140,255,.55)";
				later(() => { span.style.boxShadow = ""; }, 700);
			} catch (e) { /* Ignore */ }
			const dot = dotMap.get(id);
			if (dot) {
				dot.classList.remove("dsh-flash");
				void dot.offsetWidth; // Restart animation
				dot.classList.add("dsh-flash");
			}
		}

		/* ── Toolbars / Popups ─────────────────────────────────── */
		function makeDot(color, onClick) {
			return h("button", { class: "dot", style: `background:${COLORS[color]}`, title: COLOR_NAMES[color] || color, onclick: onClick });
		}
		function makeIcon(icon, title, onClick) {
			return h("button", { class: "ibtn", title, html: ICONS[icon], onclick: onClick });
		}
		function getHlRect(id) {
			const s = document.querySelector(`span.${CLASS}[${ID_ATTR}="${id}"]`);
			return s ? s.getBoundingClientRect() : { left: 100, top: 100, width: 0, height: 0, bottom: 110 };
		}

		function showSelectToolbar(range, selText) {
			hideUI(); ensureHost();
			const rect = range.getBoundingClientRect();
			if (!rect || (rect.width === 0 && rect.height === 0)) return;
			const bar = h("div", { class: "toolbar" });
			QUICK.forEach((c) => bar.appendChild(makeDot(c, () => applyNew(range, selText, c))));
			bar.appendChild(makeIcon("palette", "More colors", () => {
				hideUI(); ensureHost();
				const pop = h("div", { class: "popup palette" });
				Object.keys(COLORS).forEach((c) => pop.appendChild(makeDot(c, () => applyNew(range, selText, c))));
				placeFixed(pop, rect, true);
			}));
			bar.appendChild(h("span", { class: "sep" }));
			bar.appendChild(makeIcon("tag", "Tag", () => {
				const id = applyNew(range, selText, DEFAULT_COLOR);
				if (id) later(() => openTagPopup(id, getHlRect(id)), 30);
			}));
			bar.appendChild(makeIcon("copy", "Copy", () => copyText(selText, rect)));
			placeFixed(bar, rect, true);
		}
		function applyNew(range, text, color) {
			if (range.collapsed) return null;
			const id = uid();
			const { prefix, suffix } = contextAround(range);
			const spans = wrapRange(range, id, color);
			if (!spans.length) return null;
			store.set(id, { id, text, color, note: "", tags: [], prefix, suffix });
			save();
			hideUI();
			const sel = window.getSelection();
			if (sel) sel.removeAllRanges();
			scheduleRail();
			return id;
		}
		function showManageToolbar(id) {
			const rec = store.get(id);
			if (!rec) return;
			hideUI(); ensureHost();
			const rect = getHlRect(id);
			const bar = h("div", { class: "toolbar" });
			bar.appendChild(makeIcon("palette", "Change color", () => {
				hideUI(); ensureHost();
				const pop = h("div", { class: "popup palette" });
				Object.keys(COLORS).forEach((c) => pop.appendChild(makeDot(c, () => {
					const r = store.get(id);
					if (!r) return;
					r.color = c;
					document.querySelectorAll(`span.${CLASS}[${ID_ATTR}="${id}"]`).forEach((s) => { s.style.backgroundColor = COLORS[c]; });
					save(); hideUI(); scheduleRail();
				})));
				placeFixed(pop, rect, true);
			}));
			bar.appendChild(makeIcon("note", "Add note", () => openNotePopup(id, rect)));
			bar.appendChild(makeIcon("tag", "Tag", () => openTagPopup(id, rect)));
			bar.appendChild(h("span", { class: "sep" }));
			bar.appendChild(makeIcon("copy", "Copy", () => copyText(rec.text, rect)));
			bar.appendChild(makeIcon("trash", "Delete highlight", () => {
				unwrap(id);
				store.delete(id);
				save(); hideUI(); scheduleRail();
			}));
			placeFixed(bar, rect, true);
		}
		function openNotePopup(id, rect) {
			hideUI(); ensureHost();
			const rec = store.get(id);
			if (!rec) return;
			const area = h("textarea", { class: "note-area", placeholder: "Write a note..." });
			area.value = rec.note || "";
			const saveNote = () => {
				rec.note = area.value.trim();
				save(); hideUI(); scheduleRail();
			};
			area.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveNote(); }
				if (e.key === "Escape") hideUI();
				e.stopPropagation();
			});
			const pop = h("div", { class: "popup note-card" }, [
				h("div", { class: "note-head" }, [
					h("span", { class: "note-title" }, [document.createTextNode("Note")]),
					h("button", { class: "note-close", html: ICONS.close, onclick: hideUI })
				]),
				area,
				h("div", { class: "note-foot" }, [
					h("button", { class: "send", title: "Save", html: ICONS.send, onclick: saveNote })
				])
			]);
			placeFixed(pop, rect, false);
			later(() => area.focus(), 30);
		}
		function openTagPopup(id, rect) {
			hideUI(); ensureHost();
			const rec = store.get(id);
			if (!rec) return;
			const input = h("input", { class: "tag-input", placeholder: "Enter tags, separated by space or comma", type: "text" });
			const chipsRow = h("div", { class: "tag-chips" });
			const renderChips = () => {
				chipsRow.innerHTML = "";
				(rec.tags || []).forEach((t) => {
					chipsRow.appendChild(h("span", { class: "chip" }, [
						document.createTextNode("#" + t),
						h("button", { class: "chip-x", title: "Remove tag", onclick: () => {
							rec.tags = rec.tags.filter((x) => x !== t);
							save(); renderChips();
						} }, [document.createTextNode("×")])
					]));
				});
			};
			const saveTag = () => {
				const v = input.value.trim().replace(/^#/, "");
				if (v) {
					rec.tags = rec.tags || [];
					v.split(/[,;\s\uFF0C]+/).filter(Boolean).forEach((t) => {
						if (!rec.tags.includes(t)) rec.tags.push(t);
					});
					save();
				}
				hideUI(); scheduleRail();
			};
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") { e.preventDefault(); saveTag(); }
				if (e.key === "Escape") hideUI();
				e.stopPropagation();
			});
			const pop = h("div", { class: "popup tag-card" }, [
				input,
				chipsRow,
				h("div", { class: "tag-foot" }, [
					h("button", { class: "btn btn-cancel", onclick: hideUI }, [document.createTextNode("Cancel")]),
					h("button", { class: "btn btn-ok", onclick: saveTag }, [document.createTextNode("Save")])
				])
			]);
			placeFixed(pop, rect, false);
			renderChips();
			later(() => input.focus(), 30);
		}
		function copyText(text, rect) {
			const done = () => { hideUI(); toast("Copied", rect); };
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(text).then(done).catch(() => { fallbackCopy(text); done(); });
			} else { fallbackCopy(text); done(); }
		}
		function fallbackCopy(text) {
			const ta = document.createElement("textarea");
			ta.value = text;
			ta.style.cssText = "position:fixed;opacity:0;";
			document.body.appendChild(ta);
			ta.select();
			try { document.execCommand("copy"); } catch (e) { /* Ignore */ }
			ta.remove();
		}

		/* ── Hover Tooltip (Notes & Tags) ─────────────────────── */
		let tipEl = null, tipTimer = null;
		function showTip(id, rect) {
			const rec = store.get(id);
			if (!rec) return;
			const hasNote = rec.note && rec.note.trim();
			const hasTags = rec.tags && rec.tags.length;
			if (!hasNote && !hasTags) return;
			hideTip();
			tipEl = h("div", { class: "tip" });
			if (hasTags) {
				const row = h("div");
				rec.tags.forEach((t) => row.appendChild(h("span", { class: "t-tag" }, [document.createTextNode("#" + t)])));
				tipEl.appendChild(row);
			}
			if (hasNote) tipEl.appendChild(h("div", { class: "t-note" }, [document.createTextNode(rec.note)]));
			ensureHost();
			placeFixed(tipEl, rect, true);
		}
		function hideTip() {
			if (tipEl) { tipEl.remove(); tipEl = null; }
		}

		/* ── Page Events (Capture phase to avoid page stopPropagation) ── */
		const onMouseUp = (e) => {
			if (host && host.contains(e.target)) return;
			later(() => {
				if (selectionInEditable()) return;
				const sel = window.__dshHighlighterSelfTestSelection || window.getSelection();
				if (!sel || sel.isCollapsed) return;
				const text = sel.toString().trim();
				if (!text) return;
				let range;
				try { range = sel.getRangeAt(0); } catch (err) { return; }
				showSelectToolbar(range, text);
			}, 10);
		};
		const onMouseDown = (e) => {
			if (host && host.contains(e.target)) return;
			if (e.target.closest && e.target.closest(`span.${CLASS}`)) return;
			hideUI();
		};
		const onClick = (e) => {
			const span = e.target.closest && e.target.closest(`span.${CLASS}`);
			if (span) showManageToolbar(span.getAttribute(ID_ATTR));
		};
		const onMouseOver = (e) => {
			const span = e.target.closest && e.target.closest(`span.${CLASS}`);
			if (!span) return;
			clearTimeout(tipTimer);
			const id = span.getAttribute(ID_ATTR);
			const rect = span.getBoundingClientRect();
			tipTimer = later(() => showTip(id, rect), 250);
		};
		const onMouseOut = (e) => {
			const span = e.target.closest && e.target.closest(`span.${CLASS}`);
			if (!span) return;
			clearTimeout(tipTimer);
			tipTimer = later(hideTip, 300);
		};
		const onScroll = () => { hideTip(); };
		const onResize = () => { hideUI(); scheduleRail(); };

		document.addEventListener("mouseup", onMouseUp, true);
		document.addEventListener("mousedown", onMouseDown, true);
		document.addEventListener("click", onClick, true);
		document.addEventListener("mouseover", onMouseOver, true);
		document.addEventListener("mouseout", onMouseOut, true);
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onResize);

		/* ── MutationObserver: Re-anchoring against React re-renders ── */
		let anchorTimer = null;
		function scheduleAnchor() {
			clearTimeout(anchorTimer);
			anchorTimer = setTimeout(() => {
				try { anchorAll(); scheduleRail(); } catch (e) { /* Ignore transient DOM states */ }
			}, 700);
		}
		const mo = new MutationObserver(() => scheduleAnchor());
		let observerStarted = false;

		/* ── Read-only Runtime Diagnostics (for validation scripts) ── */
		window.__dshHighlighterDiagnostics = Object.freeze({
			version: INSTANCE_VERSION,
			health() {
				const result = {
					ok: false,
					version: INSTANCE_VERSION,
					loaded: window.__dshHighlighterLoaded === true,
					bodyReady: !!document.body,
					pageStyle: !!(pageStyle && pageStyle.isConnected),
					shadowDom: !!(shadow && host && host.isConnected),
					storedHighlights: store.size
				};
				result.ok = result.loaded && result.bodyReady && result.pageStyle && result.shadowDom;
				return result;
			},
			async selfTest() {
				if (!document.body) return { ok: false, reason: "no-body" };
				const before = localStorage.getItem(STORE_KEY);
				const existingUi = uiRoot && Array.from(uiRoot.children).some((el) => el !== railEl);
				if (existingUi) return { ok: false, reason: "ui-busy", storageUnchanged: true };

				const fixture = document.createElement("span");
				fixture.id = "dsh-highlighter-self-test";
				fixture.textContent = "dsh highlighter self test";
				fixture.style.cssText = "position:fixed;left:-10000px;top:1px;white-space:nowrap;";
				(document.body || document.documentElement).appendChild(fixture);
				const range = document.createRange();
				range.selectNodeContents(fixture);
				try {
					Object.defineProperty(range, "getBoundingClientRect", {
						configurable: true,
						value: () => ({ left: 40, right: 240, top: 80, bottom: 100, width: 200, height: 20 })
					});
				} catch (e) {
					range.getBoundingClientRect = () => ({ left: 40, right: 240, top: 80, bottom: 100, width: 200, height: 20 });
				}
				window.__dshHighlighterSelfTestSelection = {
					isCollapsed: false,
					toString: () => fixture.textContent,
					getRangeAt: () => range
				};

				let toolbarCreated = false;
				try {
					fixture.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
					await new Promise((resolve) => setTimeout(resolve, 60));
					toolbarCreated = !!(shadow && shadow.querySelector(".toolbar"));
				} finally {
					delete window.__dshHighlighterSelfTestSelection;
					hideUI();
					fixture.remove();
				}
				const storageUnchanged = localStorage.getItem(STORE_KEY) === before;
				return {
					ok: toolbarCreated && storageUnchanged && !document.getElementById("dsh-highlighter-self-test"),
					toolbarCreated,
					shadowDom: !!shadow,
					storageUnchanged,
					cleaned: !document.getElementById("dsh-highlighter-self-test") && !(shadow && shadow.querySelector(".toolbar"))
				};
			}
		});

		/* ── Initialization ───────────────────────────────────── */
		function boot() {
			if (!document.body) {
				later(boot, 300);
				return;
			}
			ensureStyle();
			loadRecords().forEach((r) => { if (!store.has(r.id)) store.set(r.id, r); });
			anchorAll();
			scheduleRail();
			if (!observerStarted) {
				mo.observe(document.body, { childList: true, subtree: true, characterData: true });
				observerStarted = true;
			}
			later(() => { anchorAll(); scheduleRail(); }, 2500);
		}

		function dispose() {
			window.__dshHighlighterLoaded = false;
			window.__dshHighlighterDiagnostics = undefined;
			clearTimeout(saveTimer);
			clearTimeout(buildTimer);
			clearTimeout(anchorTimer);
			clearTimeout(tipTimer);
			timers.forEach((t) => clearTimeout(t));
			timers.clear();
			if (observerStarted) { mo.disconnect(); observerStarted = false; }
			document.removeEventListener("mouseup", onMouseUp, true);
			document.removeEventListener("mousedown", onMouseDown, true);
			document.removeEventListener("click", onClick, true);
			document.removeEventListener("mouseover", onMouseOver, true);
			document.removeEventListener("mouseout", onMouseOut, true);
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onResize);
			if (host && host.parentNode) host.parentNode.removeChild(host);
			host = null; shadow = null; uiRoot = null; railEl = null;
			dotMap.clear();
			if (pageStyle && pageStyle.parentNode) pageStyle.parentNode.removeChild(pageStyle);
			pageStyle = null;
		}

		function apply(ctx) {
			ctx.on("dispose", dispose);
			boot();
		}

		exports.apply = apply;
		exports.inject = [];
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
