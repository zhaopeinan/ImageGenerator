var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
import { d as vt, a6 as bt, w as re, o as yt, c as h, R as ht, G as Se, M as Te, z as g, k as _, B as o, I as l, u as r, N as U, H as M, J as De, a3 as wt, a0 as q, b as z, F as P, Y as O, A as J, W as I, O as Ue, r as Y, C as d } from "./vendor-vue-hMeO97m5.js";
import { _ as _t } from "./ConfirmDialog.vue_vue_type_script_setup_true_lang-CvfXb4J_.js";
import { a as kt } from "./AppLayout.vue_vue_type_script_setup_true_lang-D9-SHJ-Z.js";
import { a as xt, u as Gt, _ as G, aG as ze, L as Et } from "./index-CleCVXFw.js";
import { u as It } from "./imageGenerator-CX1zM4zJ.js";
import { b as Fe } from "./apiError-i15806Bc.js";
import { b as Ct } from "./gatewayEndpoint-DycZ91hV.js";
import { u as St } from "./vendor-i18n-YzmmkrdN.js";
import "./onboarding-5HirH5LH.js";
import "./vendor-misc-CjwlkjM2.js";
import "./LocaleSwitcher-BN8wdJiK.js";
import "./Select-B6Jce86U.js";
async function Re(c, v, a, u = {}) {
  const w = Tt(c), p = await Promise.allSettled(Array.from({ length: w }, async (y, b) => {
    const Q = await v(1, b), F = a(Q, b).slice(0, 1);
    if (F.length === 0) throw new Error("Image batch response did not contain images");
    return u.onImages && await u.onImages(F, b), F;
  })), k = p.find((y) => y.status === "rejected");
  if (k) throw k.reason;
  const x = p.flatMap((y) => y.status === "fulfilled" ? y.value : []).slice(0, w);
  if (x.length < w) throw new Error("Image batch response did not contain enough images");
  return x;
}
__name(Re, "Re");
function Tt(c) {
  const v = typeof c == "number" ? c : Number(c);
  return Number.isFinite(v) ? Math.max(1, Math.floor(v)) : 1;
}
__name(Tt, "Tt");
const Dt = Ct;
async function Ut(c) {
  const v = c.startsWith("data:") ? Le(c) : await Ae(c);
  return v.type === "image/png" ? v : Me(v);
}
__name(Ut, "Ut");
async function zt(c) {
  return c.startsWith("data:") ? Le(c) : Ae(c);
}
__name(zt, "zt");
async function Ft(c) {
  var a;
  if (!((a = navigator.clipboard) != null && a.write) || typeof ClipboardItem > "u") throw new Error("Clipboard image write is not supported");
  const v = c.type === "image/png" ? c : await Me(c);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": v })]);
}
__name(Ft, "Ft");
function Le(c) {
  var x;
  if (!c.startsWith("data:") || !c.includes(",")) throw new Error("Invalid data URL");
  const [v, a] = c.split(",", 2), u = ((x = v.match(/^data:([^;]+)/)) == null ? void 0 : x[1]) || "application/octet-stream", p = /;base64$/i.test(v) ? window.atob(a) : decodeURIComponent(a), k = new Uint8Array(p.length);
  for (let y = 0; y < p.length; y += 1) k[y] = p.charCodeAt(y);
  return new Blob([k], { type: u });
}
__name(Le, "Le");
async function Ae(c) {
  const v = await fetch(c, { mode: "cors" });
  if (!v.ok) throw new Error(v.statusText);
  return v.blob();
}
__name(Ae, "Ae");
function Me(c) {
  return new Promise((v, a) => {
    const u = URL.createObjectURL(c), w = new Image();
    w.onload = () => {
      URL.revokeObjectURL(u);
      const p = document.createElement("canvas");
      p.width = w.naturalWidth, p.height = w.naturalHeight;
      const k = p.getContext("2d");
      if (!k) {
        a(new Error("Canvas is not available"));
        return;
      }
      k.drawImage(w, 0, 0), p.toBlob((x) => {
        if (!x) {
          a(new Error("Failed to encode image"));
          return;
        }
        v(x);
      }, "image/png");
    }, w.onerror = () => {
      URL.revokeObjectURL(u), a(new Error("Failed to load image"));
    }, w.src = u;
  });
}
__name(Me, "Me");
const Rt = { key: 0, class: "mx-auto max-w-3xl" }, Pt = { class: "card p-8 text-center" }, Lt = { class: "text-xl font-semibold text-gray-900 dark:text-white" }, At = { class: "mt-2 text-sm text-gray-500 dark:text-gray-400" }, Mt = { key: 1, class: "image-workspace" }, qt = { class: "image-panel" }, Bt = { class: "mb-6" }, $t = { class: "text-2xl font-semibold text-gray-900 dark:text-white" }, Nt = { class: "mt-1 text-sm text-gray-500 dark:text-gray-400" }, Ot = { class: "space-y-2" }, jt = { class: "input-label" }, Vt = { key: 0, class: "rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500 dark:border-dark-700 dark:bg-dark-800/60 dark:text-gray-400" }, Wt = { key: 1, class: "rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/70 dark:bg-red-950/30 dark:text-red-300" }, Kt = { class: "font-medium" }, Ht = { key: 2, class: "rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-300" }, Jt = ["value"], Yt = { class: "mt-4 space-y-2" }, Qt = { class: "input-label", for: "image-generator-endpoint" }, Xt = ["disabled"], Zt = ["value"], ea = { class: "text-xs text-gray-500 dark:text-gray-400" }, ta = { class: "mt-6 border-b border-gray-200 dark:border-dark-700" }, aa = { class: "-mb-px flex gap-6", "aria-label": "Tabs" }, na = { key: 0, class: "rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200" }, ra = { class: "input-label", for: "image-generator-prompt" }, oa = ["placeholder"], ia = { key: 1, class: "space-y-4" }, sa = { class: "upload-grid" }, la = { class: "upload-card" }, ua = ["src"], da = ["title"], ca = { class: "upload-card" }, ma = ["src"], ga = ["title"], pa = { class: "grid gap-4 sm:grid-cols-2" }, fa = { class: "input-label", for: "image-generator-size" }, va = ["value"], ba = { class: "input-label", for: "image-generator-quality" }, ya = ["value"], ha = { class: "input-label", for: "image-generator-count" }, wa = ["max"], _a = { class: "mt-1 text-xs text-gray-500 dark:text-gray-400" }, ka = { class: "input-label", for: "image-generator-format" }, xa = ["disabled"], Ga = { class: "gallery-panel" }, Ea = { class: "gallery-header" }, Ia = { class: "text-xl font-semibold text-gray-900 dark:text-white" }, Ca = { class: "mt-1 text-xs text-gray-500 dark:text-gray-400" }, Sa = { class: "flex items-center gap-2" }, Ta = { value: "all" }, Da = { value: "generate" }, Ua = { value: "edit" }, za = ["disabled", "title"], Fa = { key: 0, class: "gallery-empty" }, Ra = { key: 1, class: "gallery-grid" }, Pa = ["src"], La = { class: "image-card-body" }, Aa = { class: "line-clamp-2 text-sm text-gray-700 dark:text-gray-300" }, Ma = { class: "mt-3 flex items-center justify-between gap-2" }, qa = { class: "rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500 dark:bg-dark-700 dark:text-gray-400" }, Ba = { class: "flex items-center gap-1" }, $a = ["title", "onClick"], Na = ["title", "onClick"], Oa = ["title", "onClick"], ja = ["title", "onClick"], Pe = "gpt-image-2", Va = "https://test.tokenlab.cc.cd", Wa = "https://api.test.tokenlab.cc.cd", Ka = vt({ __name: "ImageGeneratorView", setup(c) {
  const v = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/webp"]), { t: a } = St(), u = xt(), w = Gt(), p = It(), k = Y(null), x = Y(null), y = Y(null), b = Y(null), { loadingKeys: Q, selectedKeyId: F, activeTab: E, prompt: T, size: B, quality: $, count: j, format: R, galleryFilter: X, selectedEndpoint: C, galleryItems: oe, sourceFile: Z, maskFile: qe, sourcePreview: ee, maskPreview: te, submitting: ie, usableKeys: N, selectedKey: L, hasActiveJob: se, filteredGallery: le } = bt(p), Be = h(() => [{ value: "auto", label: a("imageGenerator.optionAuto") }]), $e = h(() => [{ value: "low", label: a("imageGenerator.qualityLow") }, { value: "medium", label: a("imageGenerator.qualityMedium") }, { value: "high", label: a("imageGenerator.qualityHigh") }]), ue = h(() => {
    var e;
    return ((e = u.cachedPublicSettings) == null ? void 0 : e.image_generator_enabled) === true;
  }), Ne = h(() => u.publicSettingsLoaded && u.cachedPublicSettings !== null), V = h(() => {
    var e;
    if (Ne.value) return me((e = u.cachedPublicSettings) == null ? void 0 : e.image_generator_web_max_count, 1);
  }), W = h(() => {
    var e;
    return me((e = w.user) == null ? void 0 : e.concurrency, V.value ?? 1);
  }), A = h(() => {
    if (V.value !== void 0) return Math.min(W.value, V.value);
  }), Oe = h(() => a("imageGenerator.countLimitHint", { limit: A.value ?? W.value, userLimit: W.value, globalLimit: V.value ?? W.value })), D = h(() => {
    var i, m;
    const e = [], t = /* @__PURE__ */ new Set(), s = ze((i = u.cachedPublicSettings) == null ? void 0 : i.api_base_url, window.location.origin);
    ne(e, t, { name: a("imageGenerator.defaultEndpointName"), endpoint: s, isDefault: true });
    for (const n of ((m = u.cachedPublicSettings) == null ? void 0 : m.custom_endpoints) || []) n.endpoint.trim() && ne(e, t, { name: n.name || n.endpoint, endpoint: n.endpoint, isDefault: false });
    return Ye(window.location.origin) && ne(e, t, { name: a("imageGenerator.testEndpointName"), endpoint: Wa, isDefault: false }), e;
  }), je = h(() => D.value.find((e) => e.value === C.value) || D.value[0] || null), K = h(() => {
    var e;
    return ((e = je.value) == null ? void 0 : e.value) || window.location.origin;
  }), de = h(() => D.value.find((e) => e.value !== K.value && !e.isDefault) || D.value.find((e) => e.value !== K.value) || null), Ve = h(() => {
    var e, t;
    return ((e = b.value) == null ? void 0 : e.kind) === "clear" ? a("imageGenerator.confirmClearTitle") : ((t = b.value) == null ? void 0 : t.kind) === "switchEndpoint" ? a("imageGenerator.switchEndpointTitle") : a("imageGenerator.confirmDeleteTitle");
  }), We = h(() => {
    var e, t;
    return ((e = b.value) == null ? void 0 : e.kind) === "clear" ? a("imageGenerator.confirmClearMessage") : ((t = b.value) == null ? void 0 : t.kind) === "switchEndpoint" ? b.value.message : a("imageGenerator.confirmDeleteMessage");
  }), Ke = h(() => {
    var e, t;
    return ((e = b.value) == null ? void 0 : e.kind) === "clear" ? a("imageGenerator.clearGallery") : ((t = b.value) == null ? void 0 : t.kind) === "switchEndpoint" ? a("imageGenerator.switchEndpointAction", { name: b.value.name }) : a("common.delete");
  }), He = h(() => {
    var e, t;
    return ((e = b.value) == null ? void 0 : e.kind) === "delete" || ((t = b.value) == null ? void 0 : t.kind) === "clear";
  }), ae = h(() => ie.value || !L.value || E.value === "edit" && !T.value.trim() || E.value === "edit" && !Z.value ? false : N.value.length > 0);
  re(A, (e) => {
    typeof e == "number" && p.clampCountToMax(e);
  }, { immediate: true }), re(j, () => {
    typeof A.value == "number" && p.clampCountToMax(A.value);
  }), re([D, C], ([e]) => {
    ce(e);
  }, { immediate: true });
  function ce(e = D.value) {
    if (e.length === 0) {
      C.value !== "" && (C.value = "");
      return;
    }
    e.some((t) => t.value === C.value) || (C.value = e[0].value);
  }
  __name(ce, "ce");
  function ne(e, t, s) {
    const i = Je(s.endpoint);
    !i || t.has(i) || (t.add(i), e.push({ name: s.name, value: i, isDefault: s.isDefault, label: s.isDefault ? a("imageGenerator.endpointOptionDefault", { name: s.name, endpoint: i }) : a("imageGenerator.endpointOptionNamed", { name: s.name, endpoint: i }) }));
  }
  __name(ne, "ne");
  function Je(e) {
    return ze(e, window.location.origin);
  }
  __name(Je, "Je");
  function Ye(e) {
    return e === Va;
  }
  __name(Ye, "Ye");
  function me(e, t) {
    return typeof e != "number" || !Number.isFinite(e) || e <= 0 ? Math.max(1, Math.floor(t)) : Math.max(1, Math.floor(e));
  }
  __name(me, "me");
  function ge() {
    return p.normalizedCount(A.value);
  }
  __name(ge, "ge");
  async function Qe() {
    if (ue.value) try {
      await p.loadKeys();
    } catch (e) {
      u.showError(Fe(e, a("imageGenerator.errors.loadKeysFailed")));
    }
  }
  __name(Qe, "Qe");
  async function Xe() {
    if (!ae.value || !L.value) return;
    const e = L.value.key;
    await p.runJob("generate", async () => {
      const t = { prompt: T.value.trim() || a("imageGenerator.promptPlaceholder"), size: B.value, quality: $.value, count: ge(), format: R.value }, s = fe("/v1/images/generations"), i = /* @__PURE__ */ __name((m) => {
        const n = { model: Pe, prompt: t.prompt, n: m, response_format: "b64_json" };
        return t.size !== "auto" && (n.size = t.size), t.quality && (n.quality = t.quality), t.format !== "png" && (n.output_format = t.format), n;
      }, "i");
      try {
        T.value.trim() || (T.value = t.prompt), await Re(t.count, () => pe(s, e, i(1)), (n) => ve(n, t.format), { onImages: /* @__PURE__ */ __name((n) => ye(n, "generate", t), "onImages") }), u.showSuccess(a("imageGenerator.generatedSuccess"));
      } catch (m) {
        Ee(m);
      }
    });
  }
  __name(Xe, "Xe");
  async function Ze() {
    if (!ae.value || !L.value || !Z.value) return;
    const e = L.value.key, t = Z.value, s = qe.value;
    await p.runJob("edit", async () => {
      const i = { prompt: T.value.trim(), size: B.value, quality: $.value, count: ge(), format: R.value }, m = fe("/v1/images/edits"), n = /* @__PURE__ */ __name((f) => {
        const S = new FormData();
        return S.append("model", Pe), S.append("prompt", i.prompt), S.append("image", t), S.append("n", String(f)), S.append("response_format", "b64_json"), i.size !== "auto" && S.append("size", i.size), i.quality && S.append("quality", i.quality), i.format !== "png" && S.append("output_format", i.format), s && S.append("mask", s), S;
      }, "n");
      try {
        await Re(i.count, () => pe(m, e, n(1)), (f) => ve(f, i.format), { onImages: /* @__PURE__ */ __name((f) => ye(f, "edit", i), "onImages") }), u.showSuccess(a("imageGenerator.editedSuccess"));
      } catch (f) {
        Ee(f);
      }
    });
  }
  __name(Ze, "Ze");
  async function pe(e, t, s) {
    const i = s instanceof FormData, m = await fetch(e, { method: "POST", headers: { Authorization: `Bearer ${t}`, ...i ? {} : { "Content-Type": "application/json" } }, body: i ? s : JSON.stringify(s) }), n = await m.text(), f = et(n);
    if (!m.ok) throw new at(tt(f) || n || m.statusText, m.status);
    return f;
  }
  __name(pe, "pe");
  function fe(e) {
    return Dt(K.value, e);
  }
  __name(fe, "fe");
  function et(e) {
    if (!e) return {};
    try {
      return JSON.parse(e);
    } catch {
      return { message: e };
    }
  }
  __name(et, "et");
  function tt(e) {
    var t;
    return ((t = e.error) == null ? void 0 : t.message) || e.message || "";
  }
  __name(tt, "tt");
  function ve(e, t = R.value) {
    const s = [];
    for (const i of e.data || []) i.b64_json && s.push(be(i.b64_json, t)), i.url && s.push(i.url);
    for (const i of e.output || []) {
      const m = i.result || i.b64_json || i.image_url;
      m && s.push(m.startsWith("http") || m.startsWith("data:") ? m : be(m, t));
    }
    if (s.length === 0) throw new Error(a("imageGenerator.errors.emptyResponse"));
    return s;
  }
  __name(ve, "ve");
  function be(e, t = R.value) {
    return e.startsWith("data:") ? e : `data:${t === "jpeg" ? "image/jpeg" : `image/${t}`};base64,${e}`;
  }
  __name(be, "be");
  async function ye(e, t, s) {
    await p.addGalleryItems(e, t, s) || u.showWarning(a("imageGenerator.errors.persistFailed"));
  }
  __name(ye, "ye");
  class at extends Error {
    static {
      __name(this, "at");
    }
    constructor(t, s) {
      super(t), this.status = s, this.name = "ImageRequestError";
    }
  }
  async function he(e, t) {
    var m;
    const s = e.target, i = (m = s.files) == null ? void 0 : m[0];
    i && (await we(i, t), s.value = "");
  }
  __name(he, "he");
  async function we(e, t) {
    if (!ke(e)) {
      u.showError(a("imageGenerator.errors.unsupportedImage"));
      return;
    }
    const s = await nt(e);
    await p.setUploadFile(t, e, s) || u.showWarning(a("imageGenerator.errors.persistFailed"));
  }
  __name(we, "we");
  async function _e(e) {
    await p.clearUploadFile(e) || u.showWarning(a("imageGenerator.errors.persistFailed"));
    const t = e === "source" ? k.value : x.value;
    t && (t.value = "");
  }
  __name(_e, "_e");
  function ke(e) {
    return v.has(e.type);
  }
  __name(ke, "ke");
  function H(e, t) {
    e.dataTransfer && (e.dataTransfer.dropEffect = "copy", y.value = t);
  }
  __name(H, "H");
  function xe(e, t) {
    const s = e.relatedTarget;
    s instanceof Node && e.currentTarget instanceof Node && e.currentTarget.contains(s) || y.value === t && (y.value = null);
  }
  __name(xe, "xe");
  async function Ge(e, t) {
    var i;
    y.value = null;
    const s = Array.from(((i = e.dataTransfer) == null ? void 0 : i.files) || []).find(ke);
    if (!s) {
      u.showError(a("imageGenerator.errors.unsupportedImage"));
      return;
    }
    await we(s, t);
  }
  __name(Ge, "Ge");
  function nt(e) {
    return new Promise((t, s) => {
      const i = new FileReader();
      i.onload = () => t(String(i.result || "")), i.onerror = () => s(i.error), i.readAsDataURL(e);
    });
  }
  __name(nt, "nt");
  async function rt(e) {
    try {
      await navigator.clipboard.writeText(e.src), u.showSuccess(a("imageGenerator.imageDataCopied"));
    } catch {
      u.showError(a("common.copyFailed"));
    }
  }
  __name(rt, "rt");
  async function ot(e) {
    try {
      const t = await Ut(e.src);
      await Ft(t), u.showSuccess(a("imageGenerator.imageCopied"));
    } catch {
      u.showError(a("imageGenerator.errors.copyImageFailed"));
    }
  }
  __name(ot, "ot");
  async function it(e) {
    let t = "";
    try {
      const s = await zt(e.src);
      t = URL.createObjectURL(s);
      const i = document.createElement("a");
      i.href = t, i.download = st(e), i.rel = "noopener", document.body.appendChild(i), i.click(), i.remove();
    } catch {
      u.showError(a("imageGenerator.errors.downloadImageFailed"));
    } finally {
      t && URL.revokeObjectURL(t);
    }
  }
  __name(it, "it");
  function st(e) {
    const t = e.format === "jpeg" ? "jpg" : e.format;
    return `tokenlab-${e.kind}-${e.createdAt.slice(0, 19).replace(/[:T]/g, "-")}.${t}`;
  }
  __name(st, "st");
  function lt(e) {
    b.value = { kind: "delete", id: e };
  }
  __name(lt, "lt");
  function ut() {
    oe.value.length !== 0 && (b.value = { kind: "clear" });
  }
  __name(ut, "ut");
  async function dt() {
    const e = b.value;
    if (b.value = null, !!e) {
      if (e.kind === "switchEndpoint") {
        C.value = e.endpoint;
        return;
      }
      e.kind === "delete" && !await p.deleteImage(e.id) && u.showWarning(a("imageGenerator.errors.persistFailed")), e.kind === "clear" && !await p.clearGallery() && u.showWarning(a("imageGenerator.errors.persistFailed"));
    }
  }
  __name(dt, "dt");
  function ct() {
    b.value = null;
  }
  __name(ct, "ct");
  function Ee(e) {
    const t = mt(e), s = pt(e) ? de.value : null;
    if (!s) {
      u.showError(t);
      return;
    }
    b.value = { kind: "switchEndpoint", endpoint: s.value, name: s.name, message: gt(t, s) };
  }
  __name(Ee, "Ee");
  function mt(e) {
    return Ie(e) ? a("imageGenerator.errors.networkFailed", { url: K.value }) : Fe(e, a("imageGenerator.errors.requestFailed"));
  }
  __name(mt, "mt");
  function gt(e, t) {
    return `${e} ${a("imageGenerator.errors.tryAlternateEndpoint", { name: t.name })}`;
  }
  __name(gt, "gt");
  function pt(e) {
    return de.value !== null && (Ie(e) || ft(e));
  }
  __name(pt, "pt");
  function ft(e) {
    return e instanceof Error && e.message === a("imageGenerator.errors.emptyResponse");
  }
  __name(ft, "ft");
  function Ie(e) {
    if (!(e instanceof TypeError)) return false;
    const t = e.message.toLowerCase();
    return t.includes("load failed") || t.includes("failed to fetch") || t.includes("networkerror") || t.includes("network request failed");
  }
  __name(Ie, "Ie");
  function Ce(e) {
    se.value && (e.preventDefault(), e.returnValue = "");
  }
  __name(Ce, "Ce");
  return yt(async () => {
    window.addEventListener("beforeunload", Ce), await p.hydrate(), await u.fetchPublicSettings(), ce(), await Qe();
  }), ht(() => {
    window.removeEventListener("beforeunload", Ce);
  }), (e, t) => {
    const s = wt("router-link");
    return d(), Se(kt, null, { default: Te(() => {
      var i, m;
      return [ue.value ? (d(), g("div", Mt, [o("section", qt, [o("div", Bt, [o("h2", $t, l(r(a)("imageGenerator.panelTitle")), 1), o("p", Nt, l(r(a)("imageGenerator.panelSubtitle")), 1)]), o("div", Ot, [o("label", jt, l(r(a)("imageGenerator.apiKey")), 1), r(Q) ? (d(), g("div", Vt, l(r(a)("imageGenerator.loadingKeys")), 1)) : r(N).length === 0 ? (d(), g("div", Wt, [o("div", Kt, l(r(a)("imageGenerator.noKey")), 1), _(s, { class: "mt-2 inline-flex text-xs font-medium underline", to: "/keys" }, { default: Te(() => [De(l(r(a)("imageGenerator.createKey")), 1)]), _: 1 })])) : (d(), g("div", Ht, l(r(a)("imageGenerator.detectedKey", { name: ((i = r(L)) == null ? void 0 : i.name) || ((m = r(N)[0]) == null ? void 0 : m.name) || "-" })), 1)), r(N).length > 0 ? U((d(), g("select", { key: 3, "onUpdate:modelValue": t[0] || (t[0] = (n) => z(F) ? F.value = n : null), class: "input" }, [(d(true), g(P, null, O(r(N), (n) => {
        var f;
        return d(), g("option", { key: n.id, value: n.id }, l(n.name) + " \xB7 " + l(((f = n.group) == null ? void 0 : f.name) || r(a)("keys.noGroup")), 9, Jt);
      }), 128))], 512)), [[q, r(F), void 0, { number: true }]]) : M("", true)]), o("div", Yt, [o("label", Qt, l(r(a)("imageGenerator.apiEndpoint")), 1), U(o("select", { id: "image-generator-endpoint", "onUpdate:modelValue": t[1] || (t[1] = (n) => z(C) ? C.value = n : null), class: "input", disabled: D.value.length <= 1 }, [(d(true), g(P, null, O(D.value, (n) => (d(), g("option", { key: n.value, value: n.value }, l(n.label), 9, Zt))), 128))], 8, Xt), [[q, r(C)]]), o("p", ea, l(r(a)("imageGenerator.endpointHint")), 1)]), o("div", ta, [o("nav", aa, [o("button", { type: "button", class: J(["tab-button", { "tab-button-active": r(E) === "generate" }]), onClick: t[2] || (t[2] = (n) => E.value = "generate") }, l(r(a)("imageGenerator.generateTab")), 3), o("button", { type: "button", class: J(["tab-button", { "tab-button-active": r(E) === "edit" }]), onClick: t[3] || (t[3] = (n) => E.value = "edit") }, l(r(a)("imageGenerator.editTab")), 3)])]), o("form", { class: "mt-6 space-y-5", onSubmit: t[23] || (t[23] = I((n) => r(E) === "generate" ? Xe() : Ze(), ["prevent"])) }, [r(se) ? (d(), g("div", na, l(r(a)("imageGenerator.inProgressNotice")), 1)) : M("", true), o("div", null, [o("label", ra, l(r(E) === "generate" ? r(a)("imageGenerator.prompt") : r(a)("imageGenerator.editPrompt")), 1), U(o("textarea", { id: "image-generator-prompt", "onUpdate:modelValue": t[4] || (t[4] = (n) => z(T) ? T.value = n : null), rows: "5", class: "input resize-y", placeholder: r(E) === "generate" ? r(a)("imageGenerator.promptPlaceholder") : r(a)("imageGenerator.editPromptPlaceholder") }, null, 8, oa), [[Ue, r(T)]])]), r(E) === "edit" ? (d(), g("div", ia, [o("div", sa, [o("div", la, [o("button", { type: "button", class: J(["upload-zone", { "upload-zone-dragging": y.value === "source" }]), onClick: t[6] || (t[6] = (n) => {
        var f;
        return (f = k.value) == null ? void 0 : f.click();
      }), onDragenter: t[7] || (t[7] = I((n) => H(n, "source"), ["prevent"])), onDragover: t[8] || (t[8] = I((n) => H(n, "source"), ["prevent"])), onDragleave: t[9] || (t[9] = I((n) => xe(n, "source"), ["prevent"])), onDrop: t[10] || (t[10] = I((n) => Ge(n, "source"), ["prevent"])) }, [o("input", { ref_key: "sourceInput", ref: k, class: "hidden", type: "file", accept: "image/png,image/jpeg,image/webp", onChange: t[5] || (t[5] = (n) => he(n, "source")) }, null, 544), r(ee) ? (d(), g("img", { key: 0, src: r(ee), alt: "", class: "upload-preview" }, null, 8, ua)) : (d(), g(P, { key: 1 }, [_(G, { name: "upload", size: "lg", class: "text-gray-400" }), o("span", null, l(r(a)("imageGenerator.sourceImage")), 1), o("small", null, l(r(a)("imageGenerator.dropHint")), 1)], 64))], 34), r(ee) ? (d(), g("button", { key: 0, type: "button", class: "upload-clear-button", title: r(a)("imageGenerator.removeSourceImage"), onClick: t[11] || (t[11] = I((n) => _e("source"), ["stop"])) }, [_(G, { name: "x", size: "sm", "stroke-width": 2 })], 8, da)) : M("", true)]), o("div", ca, [o("button", { type: "button", class: J(["upload-zone", { "upload-zone-dragging": y.value === "mask" }]), onClick: t[13] || (t[13] = (n) => {
        var f;
        return (f = x.value) == null ? void 0 : f.click();
      }), onDragenter: t[14] || (t[14] = I((n) => H(n, "mask"), ["prevent"])), onDragover: t[15] || (t[15] = I((n) => H(n, "mask"), ["prevent"])), onDragleave: t[16] || (t[16] = I((n) => xe(n, "mask"), ["prevent"])), onDrop: t[17] || (t[17] = I((n) => Ge(n, "mask"), ["prevent"])) }, [o("input", { ref_key: "maskInput", ref: x, class: "hidden", type: "file", accept: "image/png,image/jpeg,image/webp", onChange: t[12] || (t[12] = (n) => he(n, "mask")) }, null, 544), r(te) ? (d(), g("img", { key: 0, src: r(te), alt: "", class: "upload-preview" }, null, 8, ma)) : (d(), g(P, { key: 1 }, [_(G, { name: "upload", size: "lg", class: "text-gray-400" }), o("span", null, l(r(a)("imageGenerator.maskImage")), 1), o("small", null, l(r(a)("imageGenerator.dropHint")), 1)], 64))], 34), r(te) ? (d(), g("button", { key: 0, type: "button", class: "upload-clear-button", title: r(a)("imageGenerator.removeMaskImage"), onClick: t[18] || (t[18] = I((n) => _e("mask"), ["stop"])) }, [_(G, { name: "x", size: "sm", "stroke-width": 2 })], 8, ga)) : M("", true)])])])) : M("", true), o("div", pa, [o("div", null, [o("label", fa, l(r(a)("imageGenerator.size")), 1), U(o("select", { id: "image-generator-size", "onUpdate:modelValue": t[19] || (t[19] = (n) => z(B) ? B.value = n : null), class: "input" }, [(d(true), g(P, null, O(Be.value, (n) => (d(), g("option", { key: n.value, value: n.value }, l(n.label), 9, va))), 128))], 512), [[q, r(B)]])]), o("div", null, [o("label", ba, l(r(a)("imageGenerator.quality")), 1), U(o("select", { id: "image-generator-quality", "onUpdate:modelValue": t[20] || (t[20] = (n) => z($) ? $.value = n : null), class: "input" }, [(d(true), g(P, null, O($e.value, (n) => (d(), g("option", { key: n.value, value: n.value }, l(n.label), 9, ya))), 128))], 512), [[q, r($)]])]), o("div", null, [o("label", ha, l(r(a)("imageGenerator.count")), 1), U(o("input", { id: "image-generator-count", "onUpdate:modelValue": t[21] || (t[21] = (n) => z(j) ? j.value = n : null), class: "input", min: "1", max: A.value, type: "number" }, null, 8, wa), [[Ue, r(j), void 0, { number: true }]]), o("p", _a, l(Oe.value), 1)]), o("div", null, [o("label", ka, l(r(a)("imageGenerator.format")), 1), U(o("select", { id: "image-generator-format", "onUpdate:modelValue": t[22] || (t[22] = (n) => z(R) ? R.value = n : null), class: "input" }, [...t[25] || (t[25] = [o("option", { value: "png" }, "PNG", -1), o("option", { value: "jpeg" }, "JPEG", -1), o("option", { value: "webp" }, "WEBP", -1)])], 512), [[q, r(R)]])])]), o("button", { type: "submit", class: "btn btn-primary w-full justify-center", disabled: !ae.value }, [r(ie) ? (d(), Se(G, { key: 0, name: "refresh", size: "sm", class: "mr-2 animate-spin" })) : M("", true), De(" " + l(r(E) === "generate" ? r(a)("imageGenerator.generateAction") : r(a)("imageGenerator.editAction")), 1)], 8, xa)], 32)]), o("section", Ga, [o("div", Ea, [o("div", null, [o("h2", Ia, l(r(a)("imageGenerator.gallery")), 1), o("p", Ca, l(r(a)("imageGenerator.localOnly")), 1)]), o("div", Sa, [U(o("select", { "onUpdate:modelValue": t[24] || (t[24] = (n) => z(X) ? X.value = n : null), class: "input h-9 w-32 py-1 text-sm" }, [o("option", Ta, l(r(a)("imageGenerator.filterAll")), 1), o("option", Da, l(r(a)("imageGenerator.filterGenerated")), 1), o("option", Ua, l(r(a)("imageGenerator.filterEdited")), 1)], 512), [[q, r(X)]]), o("button", { type: "button", class: "btn btn-secondary h-9 px-3", disabled: r(oe).length === 0, title: r(a)("imageGenerator.clearGallery"), onClick: ut }, [_(G, { name: "trash", size: "sm" })], 8, za)])]), r(le).length === 0 ? (d(), g("div", Fa, [_(G, { name: "inbox", size: "xl", class: "mx-auto mb-3 text-gray-300 dark:text-dark-600" }), o("span", null, l(r(a)("imageGenerator.emptyGallery")), 1)])) : (d(), g("div", Ra, [(d(true), g(P, null, O(r(le), (n) => (d(), g("article", { key: n.id, class: "image-card" }, [o("img", { src: n.src, alt: "", class: "image-card-img" }, null, 8, Pa), o("div", La, [o("p", Aa, l(n.prompt), 1), o("div", Ma, [o("span", qa, l(n.kind === "generate" ? r(a)("imageGenerator.filterGenerated") : r(a)("imageGenerator.filterEdited")), 1), o("div", Ba, [o("button", { type: "button", class: "icon-button", title: r(a)("imageGenerator.copyImageData"), onClick: /* @__PURE__ */ __name((f) => rt(n), "onClick") }, [_(G, { name: "database", size: "sm" })], 8, $a), o("button", { type: "button", class: "icon-button", title: r(a)("imageGenerator.copyImageFile"), onClick: /* @__PURE__ */ __name((f) => ot(n), "onClick") }, [_(G, { name: "copy", size: "sm" })], 8, Na), o("button", { type: "button", class: "icon-button", title: r(a)("imageGenerator.download"), onClick: /* @__PURE__ */ __name((f) => it(n), "onClick") }, [_(G, { name: "download", size: "sm" })], 8, Oa), o("button", { type: "button", class: "icon-button text-red-500 hover:text-red-600", title: r(a)("imageGenerator.deleteImage"), onClick: /* @__PURE__ */ __name((f) => lt(n.id), "onClick") }, [_(G, { name: "trash", size: "sm" })], 8, ja)])])])]))), 128))]))])])) : (d(), g("div", Rt, [o("div", Pt, [_(G, { name: "sparkles", size: "xl", class: "mx-auto mb-4 text-gray-300 dark:text-dark-600" }), o("h2", Lt, l(r(a)("imageGenerator.disabledTitle")), 1), o("p", At, l(r(a)("imageGenerator.disabledDescription")), 1)])])), _(_t, { show: b.value !== null, title: Ve.value, message: We.value, "confirm-text": Ke.value, "cancel-text": r(a)("common.cancel"), danger: He.value, onConfirm: dt, onCancel: ct }, null, 8, ["show", "title", "message", "confirm-text", "cancel-text", "danger"])];
    }), _: 1 });
  };
} }), dn = Et(Ka, [["__scopeId", "data-v-95f45906"]]);
export {
  dn as default
};
