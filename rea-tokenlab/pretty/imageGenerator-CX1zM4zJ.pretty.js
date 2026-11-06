var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
import { D as ur, w as kt, r as P, n as cr, c as Ye } from "./vendor-vue-hMeO97m5.js";
import { m as dr } from "./index-CleCVXFw.js";
const fr = "gpt-image-2", Ie = "tokenlab:image-generator:gallery:v2", Be = "tokenlab:image-generator:gallery:index:v2", Te = "tokenlab:image-generator:gallery:pending-delete:v2", yr = "tokenlab:image-generator:gallery:item:v2:", gt = "tokenlab:image-generator:gallery-meta:v2", Ne = "tokenlab:image-generator:draft:v2", lt = "tokenlab:image-generator:draft:metadata:v2", _e = "tokenlab:image-generator:draft:source-file:v2", xe = "tokenlab:image-generator:draft:mask-file:v2", de = "tokenlab:image-generator:clear-epoch:v2", pt = "tokenlab:image-generator:legacy-checkpoint:v2", mr = "tokenlab-image-generator-v2", U = "kv-v2", $e = "tokenlab:image-generator:gallery:v1", gr = "tokenlab:image-generator:gallery:index:v1", pr = "tokenlab:image-generator:gallery:item:", vr = "tokenlab:image-generator:gallery-meta:v1", vt = "tokenlab:image-generator:draft:v1", wr = "tokenlab:image-generator:draft:metadata:v1", br = "tokenlab:image-generator:draft:source-file:v1", Ar = "tokenlab:image-generator:draft:mask-file:v1", ut = "tokenlab:image-generator:clear-epoch:v1", Ir = "tokenlab-image-generator", Se = "kv", re = 18, Dr = /* @__PURE__ */ new Set(["auto"]);
function We() {
  if (typeof window > "u") return false;
  try {
    return typeof window.localStorage < "u";
  } catch {
    return false;
  }
}
__name(We, "We");
function ce(t) {
  if (!We()) return null;
  try {
    return window.localStorage.getItem(t);
  } catch {
    return null;
  }
}
__name(ce, "ce");
function nt(t, a) {
  if (!We()) return false;
  try {
    return window.localStorage.setItem(t, a), true;
  } catch {
    return false;
  }
}
__name(nt, "nt");
function ze(t) {
  if (!We()) return false;
  try {
    return window.localStorage.removeItem(t), true;
  } catch {
    return false;
  }
}
__name(ze, "ze");
function ot() {
  const t = ce(de);
  return wt(t);
}
__name(ot, "ot");
function wt(t) {
  if (!t) return { id: "" };
  try {
    const a = JSON.parse(t);
    return typeof a.id == "string" ? { id: a.id } : { id: "" };
  } catch {
    return { id: "" };
  }
}
__name(wt, "wt");
function $(t, a) {
  if (!t || typeof t != "object") return a === "";
  const o = t.clearEpoch;
  return (typeof o == "string" ? o : "") === a;
}
__name($, "$");
function Re(t) {
  if (typeof t != "string" || !t.trim()) return 0;
  const a = Date.parse(t);
  return Number.isFinite(a) ? a : 0;
}
__name(Re, "Re");
function hr(t) {
  const a = /^clear-(\d+)-/.exec(t);
  if (!a) return 0;
  const o = Number(a[1]);
  return Number.isFinite(o) ? o : 0;
}
__name(hr, "hr");
function Lt(t, a, o) {
  return Re(t) > Math.max(Re(a), hr(o));
}
__name(Lt, "Lt");
function Le(t) {
  const o = [Ie, gt, Ne].map((c) => {
    if (t !== void 0) {
      const u = ce(c);
      if (u) try {
        if ($(JSON.parse(u), t)) return true;
      } catch {
      }
    }
    return ze(c);
  }).every(Boolean), d = [$e, vr, vt].map(ze).every(Boolean);
  return o && d;
}
__name(Le, "Le");
function Er(t) {
  for (const a of [Ie, gt, Ne]) {
    const o = ce(a);
    if (o) {
      try {
        if ($(JSON.parse(o), t)) continue;
      } catch {
      }
      ze(a);
    }
  }
}
__name(Er, "Er");
function ae() {
  return typeof window < "u" && typeof window.indexedDB < "u";
}
__name(ae, "ae");
let qe = null, st = null;
function ge() {
  if (!ae()) return Promise.reject(new Error("IndexedDB is not available"));
  const t = window.indexedDB;
  if (qe && st === t) return qe;
  const a = new Promise((o, d) => {
    let c;
    try {
      c = window.indexedDB.open(mr, 1);
    } catch (u) {
      d(u);
      return;
    }
    c.onupgradeneeded = () => {
      const u = c.result;
      u.objectStoreNames.contains(U) || u.createObjectStore(U);
    }, c.onsuccess = () => o(c.result), c.onerror = () => d(c.error || new Error("Failed to open IndexedDB")), c.onblocked = () => d(new Error("IndexedDB upgrade was blocked"));
  }).catch((o) => {
    throw qe = null, st = null, o;
  });
  return qe = a, st = t, a;
}
__name(ge, "ge");
function Ct() {
  return ae() ? new Promise((t, a) => {
    let o;
    try {
      o = window.indexedDB.open(Ir, 1);
    } catch (d) {
      a(d);
      return;
    }
    o.onupgradeneeded = () => {
      const d = o.result;
      d.objectStoreNames.contains(Se) || d.createObjectStore(Se);
    }, o.onsuccess = () => t(o.result), o.onerror = () => a(o.error || new Error("Failed to open legacy IndexedDB")), o.onblocked = () => a(new Error("Legacy IndexedDB upgrade was blocked"));
  }) : Promise.reject(new Error("IndexedDB is not available"));
}
__name(Ct, "Ct");
async function Ve(t) {
  try {
    const a = await ge(), o = await new Promise((d, c) => {
      const u = a.transaction(U, "readonly"), p = u.objectStore(U).get(t);
      p.onsuccess = () => d(p.result), p.onerror = () => c(p.error || new Error("Failed to read IndexedDB")), u.onerror = () => c(u.error || new Error("IndexedDB transaction failed"));
    });
    return o === void 0 ? { status: "missing" } : { status: "found", value: o };
  } catch {
    return { status: "error" };
  }
}
__name(Ve, "Ve");
async function Me(t, a, o) {
  return Kt(o, (d) => d.put(a, t));
}
__name(Me, "Me");
async function _t(t, a) {
  return Kt(a, (o) => o.delete(t));
}
__name(_t, "_t");
async function Kt(t, a) {
  try {
    const o = await ge();
    return await new Promise((d, c) => {
      const u = o.transaction(U, "readwrite"), p = u.objectStore(U), f = p.get(de);
      let A = false;
      f.onsuccess = () => {
        if ((typeof f.result == "string" ? f.result : "") !== t) return;
        A = true;
        const F = a(p);
        F.onerror = () => c(F.error || new Error("Failed to mutate IndexedDB"));
      }, f.onerror = () => c(f.error || new Error("Failed to read IndexedDB epoch")), u.oncomplete = () => d(A), u.onerror = () => c(u.error || new Error("IndexedDB transaction failed")), u.onabort = () => c(u.error || new Error("IndexedDB transaction aborted"));
    });
  } catch {
    return false;
  }
}
__name(Kt, "Kt");
async function ct() {
  return Ve(de);
}
__name(ct, "ct");
function Rr(t) {
  if (!t || typeof t != "object") return { galleryUpdatedAt: "", galleryIDs: [], draftUpdatedAt: "" };
  const a = t;
  return { galleryUpdatedAt: typeof a.galleryUpdatedAt == "string" ? a.galleryUpdatedAt : "", galleryIDs: Array.isArray(a.galleryIDs) ? a.galleryIDs.filter((o) => typeof o == "string" && o.length > 0) : [], draftUpdatedAt: typeof a.draftUpdatedAt == "string" ? a.draftUpdatedAt : "" };
}
__name(Rr, "Rr");
async function Sr() {
  const t = await Ve(pt);
  return t.status !== "found" ? t : { status: "found", value: Rr(t.value) };
}
__name(Sr, "Sr");
async function xt(t, a) {
  return Me(pt, t, a);
}
__name(xt, "xt");
function Fr(t) {
  return `${pr}${t}`;
}
__name(Fr, "Fr");
function Gr(t) {
  const a = ce($e);
  if (!a) return null;
  try {
    const o = oe(JSON.parse(a));
    return o && $(o, t) ? o : null;
  } catch {
    return null;
  }
}
__name(Gr, "Gr");
function kr(t) {
  const a = ce(vt);
  if (!a) return null;
  try {
    const o = JSON.parse(a);
    return o && typeof o == "object" && $(o, t) ? o : null;
  } catch {
    return null;
  }
}
__name(kr, "kr");
function Lr(t, a) {
  if (!t) return a;
  if (!a) return t;
  if (t.updatedAt && a.updatedAt) return dt(a, t.updatedAt) ? a : t;
  if (t.updatedAt) return t;
  const o = new Set(t.items.map((d) => d.id));
  return { items: [...t.items, ...a.items.filter((d) => !o.has(d.id))].slice(0, re), updatedAt: a.updatedAt, legacy: true };
}
__name(Lr, "Lr");
async function Yt() {
  let t = null;
  try {
    t = await Ct();
    const a = await new Promise((x, D) => {
      const G = t.transaction(Se, "readonly"), M = G.objectStore(Se), se = M.get(ut), ie = M.get(gr), W = M.get($e), Y = M.get(wr), N = M.get(br), pe = M.get(Ar), De = /* @__PURE__ */ new Map();
      let B, Ce, R, le, T, ve;
      se.onsuccess = () => {
        B = se.result;
      }, ie.onsuccess = () => {
        var z;
        Ce = ie.result;
        for (const V of ((z = oe(Ce)) == null ? void 0 : z.items) ?? []) {
          const C = M.get(Fr(V.id));
          C.onsuccess = () => De.set(V.id, C.result), C.onerror = () => D(C.error || new Error("Failed to read legacy gallery blob"));
        }
      }, W.onsuccess = () => {
        R = W.result;
      }, Y.onsuccess = () => {
        le = Y.result;
      }, N.onsuccess = () => {
        T = N.result;
      }, pe.onsuccess = () => {
        ve = pe.result;
      };
      for (const z of [se, ie, W, Y, N, pe]) z.onerror = () => D(z.error || new Error("Failed to read legacy image data"));
      G.oncomplete = () => x({ epoch: B, index: Ce, gallery: R, draftMetadata: le, sourceFile: T, maskFile: ve, itemValues: De }), G.onerror = () => D(G.error || new Error("Legacy image data transaction failed")), G.onabort = () => D(G.error || new Error("Legacy image data transaction aborted"));
    }), o = typeof a.epoch == "string" ? a.epoch : wt(ce(ut)).id, d = Gr(o), c = kr(o), u = oe(a.gallery), p = u && $(u, o) ? u : null, f = oe(a.index);
    let A = null;
    if (f && $(f, o)) {
      const x = mt((p == null ? void 0 : p.items) ?? []), D = [];
      for (const G of f.items) {
        const M = await Ot(a.itemValues.get(G.id), G) ?? x.get(G.id);
        if (!(M != null && M.src)) throw new Error(`Legacy gallery blob is unreadable: ${G.id}`);
        D.push(M);
      }
      A = { items: D, updatedAt: f.updatedAt, legacy: true };
    } else p && (A = { ...p, legacy: true });
    const h = a.draftMetadata && typeof a.draftMetadata == "object" && $(a.draftMetadata, o) ? a.draftMetadata : null, F = h ? c && String(c.updatedAt ?? "") >= String(h.updatedAt ?? "") ? c : h : c, m = (F == null ? void 0 : F.sourceFileStored) === true && Je(a.sourceFile) ? a.sourceFile : void 0, k = (F == null ? void 0 : F.maskFileStored) === true && Je(a.maskFile) ? a.maskFile : void 0, _ = F ? { ...F, sourceFileStored: m !== void 0, maskFileStored: k !== void 0 } : null;
    return { epoch: o, gallery: Lr(d, A), draftMetadata: _, sourceFile: m, maskFile: k, legacyDatabaseRead: true };
  } catch {
    return { epoch: "", gallery: null, draftMetadata: null, sourceFile: void 0, maskFile: void 0, legacyDatabaseRead: false };
  } finally {
    t && typeof t.close == "function" && t.close();
  }
}
__name(Yt, "Yt");
async function _r(t) {
  const a = t ? { epoch: t, gallery: null, draftMetadata: null, sourceFile: void 0, maskFile: void 0, legacyDatabaseRead: true } : await Yt();
  if (!a.legacyDatabaseRead) return { status: "error" };
  try {
    const o = await ge();
    return await new Promise((c, u) => {
      const p = o.transaction(U, "readwrite"), f = p.objectStore(U), A = f.get(de);
      let h = { status: "error" };
      A.onsuccess = () => {
        var k, _, x;
        if (typeof A.result == "string") {
          h = { status: "found", epoch: A.result };
          return;
        }
        const F = f.clear();
        F.onerror = () => u(F.error || new Error("Failed to reset image data"));
        const m = f.put(t, de);
        if (m.onerror = () => u(m.error || new Error("Failed to initialize image data epoch")), a.gallery) {
          const D = a.gallery.updatedAt || (/* @__PURE__ */ new Date()).toISOString();
          for (const G of a.gallery.items) f.put(yt(G), Pe(G.id));
          f.put({ items: a.gallery.items.map(Ue), updatedAt: D, clearEpoch: t }, Be), f.put({ items: [], updatedAt: D, clearEpoch: t }, Ie), f.put([], Te);
        }
        a.draftMetadata && (f.put({ ...a.draftMetadata, clearEpoch: t }, lt), a.sourceFile !== void 0 && f.put(a.sourceFile, _e), a.maskFile !== void 0 && f.put(a.maskFile, xe)), f.put({ galleryUpdatedAt: ((k = a.gallery) == null ? void 0 : k.updatedAt) || "", galleryIDs: ((_ = a.gallery) == null ? void 0 : _.items.map((D) => D.id)) || [], draftUpdatedAt: typeof ((x = a.draftMetadata) == null ? void 0 : x.updatedAt) == "string" ? a.draftMetadata.updatedAt : "" }, pt), h = { status: "initialized", epoch: t };
      }, A.onerror = () => u(A.error || new Error("Failed to read image data epoch")), p.oncomplete = () => c(h), p.onerror = () => u(p.error || new Error("IndexedDB transaction failed")), p.onabort = () => u(p.error || new Error("IndexedDB transaction aborted"));
    });
  } catch {
    return { status: "error" };
  }
}
__name(_r, "_r");
async function Mt(t) {
  if (!ae()) return true;
  try {
    const a = await ge();
    return await new Promise((o, d) => {
      const c = a.transaction(U, "readwrite"), u = c.objectStore(U), p = u.clear();
      p.onerror = () => d(p.error || new Error("Failed to clear IndexedDB"));
      const f = u.put(t, de);
      f.onerror = () => d(f.error || new Error("Failed to update IndexedDB epoch")), c.oncomplete = () => o(), c.onerror = () => d(c.error || new Error("IndexedDB transaction failed")), c.onabort = () => d(c.error || new Error("IndexedDB transaction aborted"));
    }), true;
  } catch {
    return false;
  }
}
__name(Mt, "Mt");
async function Bt(t) {
  if (!ae()) return true;
  try {
    const [a, o] = await Promise.all([Ct(), ge()]);
    return a === o || await new Promise((d, c) => {
      const u = a.transaction(Se, "readwrite"), p = u.objectStore(Se), f = p.clear();
      f.onerror = () => c(f.error || new Error("Failed to clear legacy IndexedDB"));
      const A = p.put(t, ut);
      A.onerror = () => c(A.error || new Error("Failed to update legacy IndexedDB epoch")), u.oncomplete = () => d(), u.onerror = () => c(u.error || new Error("Legacy IndexedDB transaction failed")), u.onabort = () => c(u.error || new Error("Legacy IndexedDB transaction aborted"));
    }), true;
  } catch {
    return false;
  }
}
__name(Bt, "Bt");
function xr(t) {
  const a = typeof t == "number" ? t : Number(t);
  return !Number.isFinite(a) || a <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.floor(a));
}
__name(xr, "xr");
function Oe(t, a) {
  const o = typeof t == "number" ? t : Number(t);
  return Number.isFinite(o) ? Math.min(xr(a), Math.max(1, Math.floor(o))) : 1;
}
__name(Oe, "Oe");
function oe(t) {
  if (Array.isArray(t)) return { items: t.slice(0, re), updatedAt: "", legacy: true };
  if (!t || typeof t != "object") return null;
  const a = t;
  return Array.isArray(a.items) ? { items: a.items.slice(0, re), updatedAt: typeof a.updatedAt == "string" ? a.updatedAt : "", clearEpoch: typeof a.clearEpoch == "string" ? a.clearEpoch : "", destructiveRevision: typeof a.destructiveRevision == "string" ? a.destructiveRevision : void 0, legacy: a.items.some((o) => !!(o != null && o.src)) } : null;
}
__name(oe, "oe");
function dt(t, a) {
  return a ? t.updatedAt ? t.updatedAt > a : false : true;
}
__name(dt, "dt");
function qt(t) {
  return t === "edit" ? "edit" : "generate";
}
__name(qt, "qt");
function Mr(t) {
  return t === "generate" || t === "edit" ? t : "all";
}
__name(Mr, "Mr");
function Br(t) {
  return t === "jpeg" || t === "webp" ? t : "png";
}
__name(Br, "Br");
function Pr(t) {
  return t === "low" || t === "high" ? t : "medium";
}
__name(Pr, "Pr");
function Pt(t) {
  return typeof t != "string" ? "auto" : Dr.has(t) ? t : "auto";
}
__name(Pt, "Pt");
function Pe(t) {
  return `${yr}${t}`;
}
__name(Pe, "Pe");
async function Tr(t) {
  try {
    const a = await ge();
    await new Promise((d, c) => {
      const u = a.transaction(U, "readwrite"), p = u.objectStore(U), f = p.get(de), A = p.get(Be), h = p.get(Te);
      let F = false, m = false, k = false, _ = false, x, D;
      const G = /* @__PURE__ */ __name(() => {
        if (!k || !F || !m || !_) return;
        const M = oe(x), se = new Set(((M == null ? void 0 : M.items) || []).map((Y) => Y.id)), ie = Array.isArray(D) ? Array.from(new Set(D.filter((Y) => typeof Y == "string" && Y.length > 0))) : [];
        for (const Y of ie.filter((N) => !se.has(N))) {
          const N = p.delete(Pe(Y));
          N.onerror = () => c(N.error || new Error("Failed to clean gallery blob"));
        }
        const W = p.put([], Te);
        W.onerror = () => c(W.error || new Error("Failed to update gallery cleanup state"));
      }, "G");
      f.onerror = () => c(f.error || new Error("Failed to read image data epoch")), f.onsuccess = () => {
        _ = (typeof f.result == "string" ? f.result : "") === t, k = true, G();
      }, A.onerror = () => c(A.error || new Error("Failed to read gallery index")), A.onsuccess = () => {
        x = A.result, F = true, G();
      }, h.onerror = () => c(h.error || new Error("Failed to read gallery cleanup state")), h.onsuccess = () => {
        D = h.result, m = true, G();
      }, u.oncomplete = () => d(), u.onerror = () => c(u.error || new Error("Gallery cleanup transaction failed")), u.onabort = () => c(u.error || new Error("Gallery cleanup transaction aborted"));
    });
    const o = await ct();
    return o.status === "found" ? o.value === t : o.status === "missing" && t === "";
  } catch {
    return false;
  }
}
__name(Tr, "Tr");
function Cr(t) {
  var a;
  if (!t.startsWith("data:") || !t.includes(",")) return null;
  try {
    const [o, d] = t.split(",", 2), c = ((a = o.match(/^data:([^;]+)/)) == null ? void 0 : a[1]) || "application/octet-stream", u = window.atob(d), p = new Uint8Array(u.length);
    for (let f = 0; f < u.length; f += 1) p[f] = u.charCodeAt(f);
    return new Blob([p], { type: c });
  } catch {
    return null;
  }
}
__name(Cr, "Cr");
function ft(t) {
  return new Promise((a, o) => {
    const d = new FileReader();
    d.onload = () => a(String(d.result || "")), d.onerror = () => o(d.error), d.readAsDataURL(t);
  });
}
__name(ft, "ft");
function yt(t) {
  const a = Cr(t.src);
  return a ? { ...t, src: "", imageBlob: a } : { ...t };
}
__name(yt, "yt");
function Ue(t) {
  return { ...t, src: "" };
}
__name(Ue, "Ue");
async function Ot(t, a) {
  if (!t || typeof t != "object") return a.src ? a : null;
  const o = t;
  let d = typeof o.src == "string" && o.src ? o.src : a.src;
  if (!d && o.imageBlob instanceof Blob) try {
    d = await ft(o.imageBlob);
  } catch {
    d = "";
  }
  return d ? { id: typeof o.id == "string" ? o.id : a.id, kind: qt(o.kind), src: d, prompt: typeof o.prompt == "string" ? o.prompt : a.prompt, model: typeof o.model == "string" ? o.model : a.model, size: typeof o.size == "string" ? o.size : a.size, quality: typeof o.quality == "string" ? o.quality : a.quality, format: typeof o.format == "string" ? o.format : a.format, createdAt: typeof o.createdAt == "string" ? o.createdAt : a.createdAt } : null;
}
__name(Ot, "Ot");
function mt(t) {
  return new Map(t.map((a) => [a.id, a]));
}
__name(mt, "mt");
function Tt(t, a, o) {
  var d;
  if (!t.startsWith("data:") || !t.includes(",")) return null;
  try {
    const [c, u] = t.split(",", 2), p = o || ((d = c.match(/^data:([^;]+)/)) == null ? void 0 : d[1]) || "application/octet-stream", f = window.atob(u), A = new Uint8Array(f.length);
    for (let h = 0; h < f.length; h += 1) A[h] = f.charCodeAt(h);
    return new File([A], a || "image.png", { type: p });
  } catch {
    return null;
  }
}
__name(Tt, "Tt");
function it(t) {
  return { blob: t, name: t.name, type: t.type, lastModified: t.lastModified };
}
__name(it, "it");
function Je(t) {
  if (!t || typeof t != "object") return null;
  const a = t;
  return a.blob instanceof Blob ? new File([a.blob], a.name || "image.png", { type: a.type || a.blob.type, lastModified: Number.isFinite(a.lastModified) ? a.lastModified : Date.now() }) : null;
}
__name(Je, "Je");
const qr = ur("imageGenerator", () => {
  const t = P([]), a = P(false), o = P(null), d = P("generate"), c = P(""), u = P("auto"), p = P("medium"), f = P(1), A = P("png"), h = P("all"), F = P(""), m = P([]), k = P(null), _ = P(null), x = P(""), D = P(""), G = P(false), M = P(null), se = P(""), ie = P(null);
  let W = false, Y = null, N = null, pe = null, De = Promise.resolve(), B = 0, R = ot().id, le = false, T = "", ve = "", z = false, V = false, C = false, H = 0, Q = 0, Xe = Promise.resolve(), He = Promise.resolve(), Z = null, j = null;
  const Qe = Ye(() => t.value.filter((e) => {
    var n, r;
    return e.status === "active" && ((n = e.group) == null ? void 0 : n.platform) === "openai" && ((r = e.group) == null ? void 0 : r.allow_image_generation) === true;
  })), Ut = Ye(() => Qe.value.find((e) => e.id === o.value) || null), bt = Ye(() => G.value || ie.value !== null), Nt = Ye(() => h.value === "all" ? m.value : m.value.filter((e) => e.kind === h.value));
  kt(Qe, (e) => {
    if (e.length === 0) {
      o.value = null;
      return;
    }
    e.some((n) => n.id === o.value) || (o.value = e[0].id);
  }, { immediate: true }), kt([o, d, c, u, p, f, A, h, F, x, D], () => {
    W && fe();
  }), typeof window < "u" && window.addEventListener("storage", (e) => {
    if (e.key !== de || !e.newValue) return;
    const n = wt(e.newValue);
    !n.id || ot().id !== n.id || (R = n.id, le = false, B += 1, Le(n.id), rt(true));
  });
  function v(e, n) {
    return !le && n === B && R === e && (ae() || ot().id === e);
  }
  __name(v, "v");
  async function we(e) {
    const n = await ct();
    if (n.status === "found") return n.value === e ? true : (await tt(n.value), false);
    if (n.status === "error") return false;
    const r = await _r(e);
    return r.status === "initialized" ? true : (r.status === "found" && r.epoch !== e && await tt(r.epoch), r.status === "found" && r.epoch === e);
  }
  __name(we, "we");
  function At(e) {
    return nt(de, JSON.stringify(e)) ? (R = e.id, true) : false;
  }
  __name(At, "At");
  async function Ze() {
    if (W) return;
    const e = R, n = B;
    if (ae() && !await we(e) || !v(e, n)) return;
    Er(e), zt();
    const r = await Jt(e, n);
    await $t(r), v(e, n) && (W = true, await fe(e, n), await Vt(e, n), v(e, n) && (W = false, await Wt(e, n), v(e, n) && (W = true, await fe(e, n), await Tr(e) || await we(e))));
  }
  __name(Ze, "Ze");
  function zt() {
    const e = ce(Ie) ?? (ae() ? null : ce($e));
    if (e) try {
      const n = oe(JSON.parse(e));
      n && $(n, R) && (m.value = n.items, T = n.updatedAt, z = n.legacy === true);
    } catch {
      m.value = [], T = "", z = false;
    }
  }
  __name(zt, "zt");
  async function Vt(e = R, n = B) {
    let r;
    try {
      r = await It(e);
    } catch {
      return;
    }
    if (v(e, n)) {
      if (z && m.value.length > 0) {
        if (r && T && dt(r, T)) {
          m.value = r.items, T = r.updatedAt, z = r.legacy === true, z ? await ye(m.value, [], [], { type: "migrate-legacy", items: m.value, observedIDs: r.observedIndexIDs ?? r.items.map((i) => i.id), observedUpdatedAt: r.observedIndexUpdatedAt ?? r.updatedAt, observedDestructiveRevision: r.observedIndexDestructiveRevision }, e, n) : je(m.value, true, e, n);
          return;
        }
        if (r && !T) {
          const i = new Set(m.value.map((l) => l.id)), s = [...m.value, ...r.items.filter((l) => !i.has(l.id))];
          m.value = s.slice(0, re);
          const y = new Set(m.value.map((l) => l.id)), g = r.items.filter((l) => !y.has(l.id)).map((l) => l.id);
          await ye(m.value, m.value, g, { type: "migrate-legacy", items: m.value, observedIDs: r.observedIndexIDs ?? r.items.map((l) => l.id), observedUpdatedAt: r.observedIndexUpdatedAt ?? r.updatedAt, observedDestructiveRevision: r.observedIndexDestructiveRevision }, e, n);
          return;
        }
        await ye(m.value, m.value, [], { type: "migrate-legacy", items: m.value, observedIDs: (r == null ? void 0 : r.observedIndexIDs) ?? (r == null ? void 0 : r.items.map((i) => i.id)) ?? [], observedUpdatedAt: (r == null ? void 0 : r.observedIndexUpdatedAt) ?? (r == null ? void 0 : r.updatedAt) ?? "", observedDestructiveRevision: r == null ? void 0 : r.observedIndexDestructiveRevision }, e, n);
        return;
      }
      r && dt(r, T) ? (m.value = r.items, T = r.updatedAt, z = r.legacy === true, z ? await ye(m.value, [], [], { type: "migrate-legacy", items: m.value, observedIDs: r.observedIndexIDs ?? r.items.map((i) => i.id), observedUpdatedAt: r.observedIndexUpdatedAt ?? r.updatedAt, observedDestructiveRevision: r.observedIndexDestructiveRevision }, e, n) : m.value.length > 0 && je(m.value, false, e, n)) : !r && m.value.length === 0 && await ye([], [], [], { type: "repair-stale" }, e, n);
    }
  }
  __name(Vt, "Vt");
  async function It(e = R) {
    const n = await ge(), r = await new Promise((y, g) => {
      const l = n.transaction(U, "readonly"), w = l.objectStore(U), b = w.get(Be), I = w.get(Ie), E = /* @__PURE__ */ new Map();
      let q, J;
      b.onsuccess = () => {
        q = b.result;
        const L = oe(q);
        for (const O of (L == null ? void 0 : L.items) ?? []) {
          const ue = w.get(Pe(O.id));
          ue.onsuccess = () => E.set(O.id, ue.result), ue.onerror = () => g(ue.error || new Error("Failed to read gallery blob"));
        }
      }, b.onerror = () => g(b.error || new Error("Failed to read gallery index")), I.onsuccess = () => {
        J = I.result;
      }, I.onerror = () => g(I.error || new Error("Failed to read legacy gallery")), l.oncomplete = () => y({ indexValue: q, legacyValue: J, itemValues: E }), l.onerror = () => g(l.error || new Error("Gallery read transaction failed")), l.onabort = () => g(l.error || new Error("Gallery read transaction aborted"));
    }), i = oe(r.indexValue);
    if (i && $(i, e)) {
      const y = oe(r.legacyValue), g = y && $(y, e) ? y : null, l = mt((g == null ? void 0 : g.items) ?? []), w = [];
      let b = false;
      for (const I of i.items) {
        const E = await Ot(r.itemValues.get(I.id), I);
        if (E) {
          w.push(E);
          continue;
        }
        const q = l.get(I.id);
        if (q != null && q.src) {
          w.push(q), b = true;
          continue;
        }
        throw new Error(`Gallery blob is unreadable: ${I.id}`);
      }
      return { items: w, updatedAt: i.updatedAt, clearEpoch: i.clearEpoch, legacy: b, observedIndexIDs: i.items.map((I) => I.id), observedIndexUpdatedAt: i.updatedAt, observedIndexDestructiveRevision: i.destructiveRevision };
    }
    const s = oe(r.legacyValue);
    return !s || !$(s, e) ? null : { ...s, legacy: s.legacy === true || s.items.some((y) => !!y.src), observedIndexIDs: [], observedIndexUpdatedAt: "", observedIndexDestructiveRevision: void 0 };
  }
  __name(It, "It");
  function Dt(e) {
    o.value = typeof e.selectedKeyId == "number" ? e.selectedKeyId : null, d.value = qt(e.activeTab), c.value = typeof e.prompt == "string" ? e.prompt : "", u.value = Pt(e.size), p.value = Pr(e.quality), f.value = Oe(e.count), A.value = Br(e.format), h.value = Mr(e.galleryFilter), F.value = typeof e.selectedEndpoint == "string" ? e.selectedEndpoint : "", ve = typeof e.updatedAt == "string" ? e.updatedAt : "", V = e.sourceFileStored === true, k.value = null, x.value = "", Z = null, typeof e.sourcePreview == "string" && e.sourcePreview && (Z = e.sourcePreview, x.value = e.sourcePreview, k.value = Tt(e.sourcePreview, e.sourceFileName || "source-image.png", e.sourceFileType)), C = e.maskFileStored === true, _.value = null, D.value = "", j = null, typeof e.maskPreview == "string" && e.maskPreview && (j = e.maskPreview, D.value = e.maskPreview, _.value = Tt(e.maskPreview, e.maskFileName || "mask-image.png", e.maskFileType));
  }
  __name(Dt, "Dt");
  async function Jt(e = R, n = B) {
    let r = null;
    if (ae()) {
      const l = await Ve(lt);
      l.status === "found" && $(l.value, e) && (r = l.value);
    }
    if (!v(e, n)) return null;
    let i = null;
    const y = ce(Ne) ?? (ae() ? null : ce(vt));
    if (y) try {
      const l = JSON.parse(y);
      l && $(l, e) && (i = l);
    } catch {
    }
    const g = r ? i && (i.updatedAt || "") >= (r.updatedAt || "") ? i : r : i;
    if (!g) return null;
    try {
      return Dt(g), g;
    } catch {
      return null;
    }
  }
  __name(Jt, "Jt");
  async function $t(e) {
    await Promise.all([Et("source", e), Et("mask", e)]);
  }
  __name($t, "$t");
  async function ht(e, n, r, i) {
    if (!v(r, i)) return false;
    const s = e === "source", y = s ? _e : xe, g = Je(n) ?? (s ? k.value : _.value);
    if (!g) return s ? (H += 1, k.value = null, x.value = "", V = false, Z = null) : (Q += 1, _.value = null, D.value = "", C = false, j = null), _t(y, r);
    let l = s ? x.value : D.value;
    if (n !== void 0) try {
      l = await ft(g);
    } catch {
      return false;
    }
    return !v(r, i) || (s ? (H += 1, k.value = g, x.value = l, V = false, Z = l || null) : (Q += 1, _.value = g, D.value = l, C = false, j = l || null), !await Me(y, it(g), r) || !v(r, i)) ? false : (s ? (V = true, Z = null) : (C = true, j = null), true);
  }
  __name(ht, "ht");
  async function Wt(e, n) {
    var E, q, J;
    if (!ae() || !v(e, n)) return;
    const [r, i] = await Promise.all([Yt(), Sr()]);
    if (!r.legacyDatabaseRead || i.status === "error" || !v(e, n)) return;
    if (e.startsWith("clear-") && r.epoch !== e) {
      await Bt(e);
      return;
    }
    const s = { galleryUpdatedAt: ((E = r.gallery) == null ? void 0 : E.updatedAt) || "", galleryIDs: ((q = r.gallery) == null ? void 0 : q.items.map((L) => L.id)) || [], draftUpdatedAt: typeof ((J = r.draftMetadata) == null ? void 0 : J.updatedAt) == "string" ? r.draftMetadata.updatedAt : "" };
    if (i.status === "missing") {
      await xt(s, e);
      return;
    }
    const y = i.value, g = { ...y };
    let l = false;
    const w = Re(s.galleryUpdatedAt) > Re(y.galleryUpdatedAt);
    if (r.gallery && w) {
      if (Lt(r.gallery.updatedAt, T, e)) {
        const L = r.gallery.items.slice(0, re), O = new Set(L.map((K) => K.id)), ue = new Set(y.galleryIDs), Ke = new Set(y.galleryIDs.filter((K) => !O.has(K))), he = [...L, ...m.value.filter((K) => !O.has(K.id) && (!ue.has(K.id) || !Ke.has(K.id)))].slice(0, re), Fe = new Set(he.map((K) => K.id)), Ge = m.value.filter((K) => !Fe.has(K.id)).map((K) => K.id), Ee = await ye(he, L, Ge, { type: "replace" }, e, n);
        if (!Ee.persisted || !v(e, n)) return;
        Ee.synchronized || (m.value = he);
      }
      g.galleryUpdatedAt = s.galleryUpdatedAt, g.galleryIDs = s.galleryIDs, l = true;
    }
    const b = r.draftMetadata, I = Re(s.draftUpdatedAt) > Re(y.draftUpdatedAt);
    if (b && I) {
      if (Lt(b.updatedAt, ve, e) && v(e, n) && (Dt(b), await Promise.all([ht("source", r.sourceFile, e, n), ht("mask", r.maskFile, e, n)]), !v(e, n) || !await fe(e, n))) return;
      g.draftUpdatedAt = s.draftUpdatedAt, l = true;
    }
    l && v(e, n) && await xt(g, e);
  }
  __name(Wt, "Wt");
  async function Et(e, n) {
    const r = e === "source", i = r ? H : Q, s = r ? _e : xe, y = r ? V : C, g = r ? Z : j, l = r ? k.value : _.value, w = R, b = B;
    if (y) {
      const J = await Ve(s);
      if (J.status === "error") return;
      const L = J.status === "found" ? Je(J.value) : null;
      if (L) {
        let O = "";
        try {
          O = await ft(L);
        } catch {
          return;
        }
        if ((r ? H : Q) !== i || !v(w, b)) return;
        r ? (k.value = L, x.value = O, Z = null) : (_.value = L, D.value = O, j = null);
        return;
      }
      r ? V = false : C = false;
    }
    if (!g || !l || (r ? H : Q) !== i) return;
    const E = await et(e, async () => {
      if ((r ? H : Q) !== i || !v(w, b)) return false;
      const L = await Me(s, it(l), w);
      return L || await we(w), L && (r ? H : Q) === i && v(w, b);
    });
    (r ? H : Q) === i && (r ? (V = E, E && (Z = null)) : (C = E, E && (j = null)), !E && n && await fe());
  }
  __name(Et, "Et");
  async function fe(e = R, n = B) {
    var g, l, w, b;
    if (!v(e, n)) return false;
    u.value = Pt(u.value);
    const r = (/* @__PURE__ */ new Date()).toISOString(), i = { clearEpoch: e, updatedAt: r, selectedKeyId: o.value, activeTab: d.value, prompt: c.value, size: u.value, quality: p.value, count: Oe(f.value), format: A.value, galleryFilter: h.value, selectedEndpoint: F.value, sourceFileStored: V, sourcePreview: Z || void 0, sourceFileName: (g = k.value) == null ? void 0 : g.name, sourceFileType: (l = k.value) == null ? void 0 : l.type, maskFileStored: C, maskPreview: j || void 0, maskFileName: (w = _.value) == null ? void 0 : w.name, maskFileType: (b = _.value) == null ? void 0 : b.type }, s = nt(Ne, JSON.stringify(i));
    if (ae()) {
      if (!await Me(lt, i, e)) return await we(e), false;
      const E = v(e, n);
      return E && (ve = r), E;
    }
    const y = s && v(e, n);
    return y && (ve = r), y;
  }
  __name(fe, "fe");
  async function ye(e, n = [], r = [], i = { type: "replace" }, s = R, y = B) {
    if (!v(s, y)) return { persisted: false, synchronized: false };
    const g = e.slice(0, re);
    T = (/* @__PURE__ */ new Date()).toISOString();
    const l = await Xt(g, T, n, r, i, s);
    if (!l && !await we(s)) return { persisted: false, synchronized: false };
    if (!v(s, y)) return { persisted: false, synchronized: false };
    let w = false;
    if (l) {
      try {
        const b = await It(s);
        b && (m.value = b.items, T = b.updatedAt, w = true);
      } catch {
      }
      z = false;
    }
    return je(l && w ? m.value : g, l, s, y), { persisted: l, synchronized: w };
  }
  __name(ye, "ye");
  async function Xt(e, n, r = [], i = [], s = { type: "replace" }, y = "") {
    try {
      const g = await ge();
      return await new Promise((l, w) => {
        const b = g.transaction(U, "readwrite"), I = b.objectStore(U), E = new Set(r.map((ne) => ne.id)), q = mt([...e, ...s.type === "add" || s.type === "migrate-legacy" ? s.items : []]), J = I.get(Be), L = I.get(Te), O = I.get(de);
        let ue = false, Ke = false, he = false, Fe = false, Ge, Ee;
        const K = /* @__PURE__ */ __name(() => {
          if (!ue || !Ke || !he || !Fe) return;
          const ne = Ge === void 0 ? { items: [], updatedAt: "", clearEpoch: y } : oe(Ge);
          if (!ne) {
            w(new Error("Gallery index is invalid")), b.abort();
            return;
          }
          const ee = $(ne, y) ? ne : { items: [], updatedAt: "", clearEpoch: y }, Rt = s.type === "repair-stale" && ee === ne ? ne.updatedAt : n;
          let te;
          if (s.type === "add") {
            const S = new Set(s.items.map((X) => X.id));
            te = [...s.items.map(Ue), ...ee.items.filter((X) => !S.has(X.id))].slice(0, re);
          } else if (s.type === "migrate-legacy") {
            const S = s.items.map(Ue), X = ee.items.map((be) => be.id), me = ee.updatedAt !== s.observedUpdatedAt || X.length !== s.observedIDs.length || X.some((be, Ae) => be !== s.observedIDs[Ae]);
            if (ee.destructiveRevision !== s.observedDestructiveRevision) te = ee.items;
            else if (me) if (ee.items.length === 0) te = ee.items;
            else {
              const be = new Set(s.observedIDs), Ae = new Set(X);
              te = [...ee.items, ...S.filter((Gt) => !be.has(Gt.id) && !Ae.has(Gt.id))].slice(0, re);
            }
            else {
              const be = new Set(S.map((Ae) => Ae.id));
              te = [...S, ...ee.items.filter((Ae) => !be.has(Ae.id))].slice(0, re);
            }
          } else if (s.type === "delete") {
            const S = new Set(s.ids);
            te = ee.items.filter((X) => !S.has(X.id));
          } else s.type === "clear" ? te = [] : s.type === "repair-stale" ? te = $(ne, y) ? ne.items : [] : te = e.map(Ue);
          const St = new Set(te.map((S) => S.id)), sr = Array.isArray(Ee) ? Ee.filter((S) => typeof S == "string" && S.length > 0) : [], ir = ne.items.filter((S) => !St.has(S.id)).map((S) => S.id), lr = Array.from(/* @__PURE__ */ new Set([...sr, ...i, ...ir])).filter((S) => !St.has(S));
          for (const S of te) {
            const X = Pe(S.id), me = q.get(S.id);
            if (E.has(S.id) && me) {
              I.put(yt(me), X);
              continue;
            }
            const ke = I.get(X);
            ke.onerror = () => w(ke.error || new Error("Failed to verify gallery blob")), ke.onsuccess = () => {
              if (ke.result === void 0) {
                if (!(me != null && me.src)) {
                  w(new Error("Gallery blob is missing")), b.abort();
                  return;
                }
                I.put(yt(me), X);
              }
            };
          }
          const Ft = { items: te, updatedAt: Rt, clearEpoch: y, destructiveRevision: s.type === "delete" || s.type === "clear" ? `${n}-${Math.random().toString(36).slice(2)}` : ee.destructiveRevision };
          I.put(Ft, Be), I.put({ items: [], updatedAt: Rt, clearEpoch: y, destructiveRevision: Ft.destructiveRevision }, Ie);
          for (const S of lr) I.delete(Pe(S));
          I.put([], Te);
        }, "K");
        J.onerror = () => w(J.error || new Error("Failed to read gallery index")), J.onsuccess = () => {
          Ge = J.result, ue = true, K();
        }, L.onerror = () => w(L.error || new Error("Failed to read gallery cleanup state")), L.onsuccess = () => {
          Ee = L.result, Ke = true, K();
        }, O.onerror = () => w(O.error || new Error("Failed to read gallery epoch")), O.onsuccess = () => {
          Fe = (typeof O.result == "string" ? O.result : "") === y, he = true, K();
        }, b.oncomplete = () => l(Fe), b.onerror = () => w(b.error || new Error("Gallery persistence transaction failed")), b.onabort = () => w(b.error || new Error("Gallery persistence transaction aborted"));
      });
    } catch {
      return false;
    }
  }
  __name(Xt, "Xt");
  function je(e, n = false, r = R, i = B) {
    if (!v(r, i)) return false;
    const s = { items: e.slice(0, re).map((g) => ({ ...g, src: "" })), updatedAt: T, clearEpoch: r }, y = nt(gt, JSON.stringify(s));
    return n && ze(Ie), y;
  }
  __name(je, "je");
  async function Ht() {
    return Y || (a.value = true, Y = dr.listAllActive().then((e) => {
      t.value = e;
    }).finally(() => {
      a.value = false, Y = null;
    }), Y);
  }
  __name(Ht, "Ht");
  async function Qt(e, n, r) {
    const i = R, s = B;
    if (!v(i, s)) return false;
    const y = e === "source" ? _e : xe, g = e === "source" ? ++H : ++Q;
    return e === "source" ? (k.value = n, x.value = r, V = false, Z = null) : (_.value = n, D.value = r, C = false, j = null), fe(), et(e, async () => {
      if (!v(i, s)) return false;
      const l = await Me(y, it(n), i);
      return l ? g !== (e === "source" ? H : Q) || !v(i, s) ? false : (e === "source" ? V = l : C = l, l && await fe(i, s)) : (await we(i), false);
    });
  }
  __name(Qt, "Qt");
  async function Zt(e) {
    const n = R, r = B;
    if (!v(n, r)) return false;
    const i = e === "source" ? _e : xe;
    e === "source" ? (H += 1, k.value = null, x.value = "", V = false, Z = null) : (Q += 1, _.value = null, D.value = "", C = false, j = null);
    const s = await fe(n, r);
    return et(e, async () => {
      if (!v(n, r)) return false;
      const y = await _t(i, n);
      return y ? s && y && v(n, r) : (await we(n), false);
    });
  }
  __name(Zt, "Zt");
  async function et(e, n) {
    let r = false;
    const s = (e === "source" ? Xe : He).catch(() => {
    }).then(async () => {
      r = await n();
    }), y = s.then(() => {
    }, () => {
    });
    return e === "source" ? Xe = y : He = y, await s, r;
  }
  __name(et, "et");
  function jt(e) {
    return f.value = Oe(f.value, e), f.value;
  }
  __name(jt, "jt");
  function er(e) {
    return f.value = Oe(f.value, e), f.value;
  }
  __name(er, "er");
  async function tr(e, n, r) {
    const i = R, s = B;
    return !v(i, s) || N && pe !== i ? false : at(async () => {
      if (!v(i, s)) return false;
      const y = (/* @__PURE__ */ new Date()).toISOString(), g = e.map((E, q) => ({ id: `${Date.now()}-${q}-${Math.random().toString(36).slice(2, 8)}`, kind: n, src: E, prompt: r ? r.prompt.trim() : c.value.trim() || se.value, model: fr, size: (r == null ? void 0 : r.size) ?? u.value, quality: (r == null ? void 0 : r.quality) ?? p.value, format: (r == null ? void 0 : r.format) ?? A.value, createdAt: y })), l = [...g, ...m.value].slice(0, re), w = new Set(l.map((E) => E.id)), b = m.value.filter((E) => !w.has(E.id)), I = await ye(l, g, b.map((E) => E.id), { type: "add", items: g }, i, s);
      return v(i, s) ? (I.synchronized || (m.value = l), I.persisted) : false;
    });
  }
  __name(tr, "tr");
  async function rr(e) {
    const n = R, r = B;
    return v(n, r) ? at(async () => {
      if (!v(n, r)) return false;
      const i = m.value.filter((y) => y.id !== e), s = await ye(i, [], [e], { type: "delete", ids: [e] }, n, r);
      return v(n, r) ? (s.synchronized || (m.value = i), s.persisted) : false;
    }) : false;
  }
  __name(rr, "rr");
  async function ar() {
    const e = R, n = B;
    return v(e, n) ? at(async () => {
      if (!v(e, n)) return false;
      const r = m.value, i = await ye([], [], r.map((s) => s.id), { type: "clear" }, e, n);
      return v(e, n) ? (i.synchronized || (m.value = []), i.persisted) : false;
    }) : false;
  }
  __name(ar, "ar");
  async function nr() {
    await Ze();
    const e = ae();
    if (bt.value || !We() && !e || le) return false;
    const n = { id: `clear-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    le = true, B += 1, await Promise.all([De.catch(() => {
    }), Xe.catch(() => {
    }), He.catch(() => {
    })]);
    let r = e ? await Mt(n.id) : true;
    const i = r && e ? await Bt(n.id) : r;
    e && r && i && (r = await Mt(n.id));
    const s = e ? await ct() : { status: "found", value: n.id };
    if (!r || !i || s.status !== "found" || s.value !== n.id) return le = false, s.status === "found" && s.value !== R && await tt(s.value), false;
    R = n.id;
    const y = Le(), g = At(n), l = Le(n.id);
    return le = false, await rt(true), e || y && l && g;
  }
  __name(nr, "nr");
  async function tt(e) {
    R = e, le = false, B += 1, Le(e), At({ id: e }), Le(e), await rt(false), await Ze();
  }
  __name(tt, "tt");
  async function rt(e) {
    W = false, H += 1, Q += 1, o.value = null, d.value = "generate", c.value = "", u.value = "auto", p.value = "medium", f.value = 1, A.value = "png", h.value = "all", F.value = "", m.value = [], k.value = null, _.value = null, x.value = "", D.value = "", T = "", z = false, V = false, C = false, Z = null, j = null, await cr(), e && (W = true);
  }
  __name(rt, "rt");
  async function at(e) {
    let n = false;
    const r = De.catch(() => {
    }).then(async () => {
      n = await e();
    });
    return De = r.then(() => {
    }, () => {
    }), await r, n;
  }
  __name(at, "at");
  function or(e, n) {
    if (N) return N;
    const r = R, i = B;
    return v(r, i) ? (G.value = true, M.value = e, se.value = c.value.trim(), ie.value = (/* @__PURE__ */ new Date()).toISOString(), pe = r, N = n().finally(() => {
      N = null, pe = null, G.value = false, M.value = null, se.value = "", ie.value = null, fe(r, i);
    }), N) : Promise.resolve();
  }
  __name(or, "or");
  return { keys: t, loadingKeys: a, selectedKeyId: o, activeTab: d, prompt: c, size: u, quality: p, count: f, format: A, galleryFilter: h, selectedEndpoint: F, galleryItems: m, sourceFile: k, maskFile: _, sourcePreview: x, maskPreview: D, submitting: G, activeJobKind: M, activeJobPrompt: se, activeJobStartedAt: ie, usableKeys: Qe, selectedKey: Ut, hasActiveJob: bt, filteredGallery: Nt, hydrate: Ze, loadKeys: Ht, setUploadFile: Qt, clearUploadFile: Zt, normalizedCount: jt, clampCountToMax: er, addGalleryItems: tr, deleteImage: rr, clearGallery: ar, clearLocalData: nr, runJob: or };
});
export {
  qr as u
};
