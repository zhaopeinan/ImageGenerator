/**
 * 双层持久化原语。
 *
 * 移植自 sub2api 的 imageGenerator 模块（线上产物 imageGenerator-CX1zM4zJ.js），
 * 保留其全部工程设计，剔除 v1 数据迁移与 generate 分支（本次只做编辑）。
 *
 * 核心设计（均为原站踩坑后的沉淀，不要随意简化）：
 *  1. 双层存储：localStorage 只放元数据，图片二进制进 IndexedDB。
 *     localStorage 有 5MB 限制，存 base64 图片必然爆。
 *  2. 世代号（clearEpoch）：清空画廊时写一个新世代号，而不是遍历删除上千条 blob。
 *     所有记录都带世代号，读写时校验，不匹配即视为过期。清空因此是 O(1)。
 *  3. 写入串行化：三条 Promise 链把所有写操作排队，杜绝并发写互相覆盖。
 *  4. 复核机制：v(epoch, revision) 在每个 await 之后重新校验世代与版本号，
 *     防止 await 期间被 storage 事件打断导致数据错乱。
 */

import type {
  DraftState,
  EpochTagged,
  GalleryIndex,
  GalleryItem,
  StoredFile,
} from '../types'
import { GALLERY_LIMIT } from '../types'

// ---------------------------------------------------------------- 键名常量

const LS_GALLERY_INDEX = 'image-editor:gallery:index'
const LS_GALLERY_LEGACY = 'image-editor:gallery:items'
const LS_GALLERY_META = 'image-editor:gallery-meta'
const LS_GALLERY_PENDING_DELETE = 'image-editor:gallery:pending-delete'
const LS_DRAFT = 'image-editor:draft'
const LS_DRAFT_METADATA = 'image-editor:draft:metadata'
const LS_SOURCE_FILE = 'image-editor:draft:source-file'
const LS_REFERENCE_FILES = 'image-editor:draft:reference-files'
const LS_MASK_FILE = 'image-editor:draft:mask-file'
const LS_CLEAR_EPOCH = 'image-editor:clear-epoch'
const LS_CHECKPOINT = 'image-editor:legacy-checkpoint'

const IDB_NAME = 'image-editor-v2'
const IDB_STORE = 'kv-v2'
const DB_VERSION = 1

/**
 * open 超时（毫秒）。见 getDB 注释：被阻塞时不会触发任何回调，必须自己兜底。
 * 设 4 秒是为了「超时 + 重试一次」总共控制在 8 秒左右，用户还能接受；
 * 再慢就会让人以为页面死了。
 */
const OPEN_TIMEOUT_MS = 4000

const ITEM_PREFIX = 'image-editor:gallery:item:v2:'

// ------------------------------------------------------------ 浏览器存储封装

function lsAvailable(): boolean {
  if (typeof window > 'undefined') return false
  try {
    return typeof window.localStorage !== 'undefined'
  } catch {
    return false
  }
}

export function lsGet(key: string): string | null {
  if (!lsAvailable()) return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function lsSet(key: string, value: string): boolean {
  if (!lsAvailable()) return false
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function lsRemove(key: string): boolean {
  if (!lsAvailable()) return false
  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

// ------------------------------------------------------------ 世代号机制

function readEpoch(): string {
  const raw = lsGet(LS_CLEAR_EPOCH)
  return parseEpoch(raw)
}

function parseEpoch(raw: string | null): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed.id === 'string' ? parsed.id : ''
  } catch {
    return ''
  }
}

/** 判断记录是否属于当前世代 */
function matchesEpoch(record: unknown, epoch: string): boolean {
  if (!record || typeof record !== 'object') return epoch === ''
  const tagged = record as EpochTagged
  return (typeof tagged.clearEpoch === 'string' ? tagged.clearEpoch : '') === epoch
}

/** 写出世代号 */
function writeEpoch(epoch: string): boolean {
  return lsSet(LS_CLEAR_EPOCH, JSON.stringify({ id: epoch }))
}

/** 读取并校验世代号的元数据 */
function readEpochTagged<T>(key: string, epoch: string): T | null {
  const raw = lsGet(key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return matchesEpoch(parsed, epoch) ? (parsed as T) : null
  } catch {
    return null
  }
}

/** 清理所有过期世代的元数据 */
function purgeStaleMetadata(epoch: string): void {
  for (const key of [LS_GALLERY_INDEX, LS_GALLERY_META, LS_DRAFT]) {
    const raw = lsGet(key)
    if (!raw) continue
    try {
      if (matchesEpoch(JSON.parse(raw), epoch)) continue
    } catch {
      /* 解析失败视为过期 */
    }
    lsRemove(key)
  }
}

// -------------------------------------------------------------- IndexedDB

function idbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

let dbPromise: Promise<IDBDatabase> | null = null

/**
 * 打开数据库，带超时、自动重试与自愈重建。
 *
 * 为什么必须有超时：`indexedDB.open()` 在库被删除操作卡住时会**永久 pending** ——
 * onsuccess/onerror/onblocked 一个都不触发（实测踩过：反复 deleteDatabase
 * 会让库进入这种状态，之后 open 永远不返回）。Promise 挂起后所有依赖它的
 * 读写全部卡死，表现为「界面一直转圈但没有任何报错」。
 *
 * 自愈策略：连续两次超时后主动 deleteDatabase 再重开一次。
 * 库里的数据本来就有 localStorage 兜底（世代号 + 草稿），重建的代价可接受。
 */
async function getDB(): Promise<IDBDatabase> {
  if (dbPromise) {
    try {
      return await dbPromise
    } catch {
      dbPromise = null
    }
  }

  let lastError: unknown = null

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await openDatabase()
    } catch (err) {
      lastError = err
      dbPromise = null
      if (attempt === 0) {
        await delay(300)
      } else if (attempt === 1 && isTimeout(err)) {
        // 第二次仍超时，判定为库卡死，删掉重建
        await deleteDatabase()
        await delay(300)
      } else {
        break
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to open IndexedDB')
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.message.includes('超时')
}

/** 删库重建。onblocked 不阻塞流程：反正旧连接已经不可用了。 */
function deleteDatabase(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, 2000)
    try {
      const request = window.indexedDB.deleteDatabase(IDB_NAME)
      request.onsuccess = finish
      request.onerror = finish
      request.onblocked = finish
    } catch {
      finish()
    }
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 单次打开尝试，内部带超时保护 */
function openDatabase(): Promise<IDBDatabase> {
  if (!idbAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available'))
  }

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      finish(() => reject(new Error('IndexedDB 打开超时（可能被其他标签页阻塞）')))
    }, OPEN_TIMEOUT_MS)

    let request: IDBOpenDBRequest
    try {
      request = window.indexedDB.open(IDB_NAME, DB_VERSION)
    } catch (err) {
      finish(() => reject(err))
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    request.onsuccess = () => {
      const db = request.result
      // 别的标签页要删库时主动让路，否则它永远阻塞
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      finish(() => resolve(db))
    }
    request.onerror = () =>
      finish(() => reject(request.error || new Error('Failed to open IndexedDB')))
    request.onblocked = () => finish(() => reject(new Error('IndexedDB upgrade was blocked')))
  })

  dbPromise = promise
  return promise
}

type ReadStatus<T> = { status: 'missing' } | { status: 'found'; value: T } | { status: 'error' }

async function idbRead<T>(key: string): Promise<ReadStatus<T>> {
  try {
    const db = await getDB()
    const value = await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(key)
      req.onsuccess = () => resolve(req.result as T | undefined)
      req.onerror = () => reject(req.error || new Error('Failed to read IndexedDB'))
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'))
    })
    return value === undefined ? { status: 'missing' } : { status: 'found', value }
  } catch {
    return { status: 'error' }
  }
}

/**
 * 在一个事务内先读世代号，匹配才执行写入。
 * 这保证「清空」操作进行时，进行中的写入不会把旧数据写回新世代。
 */
async function idbMutate(epoch: string, apply: (store: IDBObjectStore) => IDBRequest): Promise<boolean> {
  try {
    const db = await getDB()
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      const store = tx.objectStore(IDB_STORE)
      const epochReq = store.get(LS_CLEAR_EPOCH)
      let applied = false

      epochReq.onsuccess = () => {
        const current = typeof epochReq.result === 'string' ? epochReq.result : ''
        if (current !== epoch) return
        const req = apply(store)
        applied = true
        req.onerror = () => reject(req.error || new Error('Failed to mutate IndexedDB'))
      }
      epochReq.onerror = () => reject(epochReq.error || new Error('Failed to read epoch'))

      // 世代不匹配时不执行写入，applied 保持 false
      tx.oncomplete = () => resolve(applied)
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'))
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'))
    })
  } catch {
    return false
  }
}

async function idbReadEpoch(): Promise<string | null> {
  const status = await idbRead<string>(LS_CLEAR_EPOCH)
  if (status.status === 'found') return status.value
  if (status.status === 'missing') return ''
  return null
}

/** 重置存储：清空整个 store 并写入新世代号 */
async function idbReset(epoch: string): Promise<boolean> {
  if (!idbAvailable()) return true
  try {
    const db = await getDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      const store = tx.objectStore(IDB_STORE)
      const clearReq = store.clear()
      clearReq.onerror = () => reject(clearReq.error || new Error('Failed to clear'))
      const putReq = store.put(epoch, LS_CLEAR_EPOCH)
      putReq.onerror = () => reject(putReq.error || new Error('Failed to write epoch'))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('Transaction failed'))
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'))
    })
    return true
  } catch {
    return false
  }
}

async function idbPut<T>(key: string, value: T, epoch: string): Promise<boolean> {
  const result = await idbMutate(epoch, (store) => store.put(value, key))
  return result === true
}

async function idbDelete(key: string, epoch: string): Promise<boolean> {
  const result = await idbMutate(epoch, (store) => store.delete(key))
  return result === true
}

// -------------------------------------------------------------- Blob 工具

/**
 * IndexedDB 中保存的单条记录：元数据 + 可选的二进制 blob。
 * src 字段始终置空，图片内容由 imageBlob 承载。
 */
export type StoredGalleryRecord = Omit<GalleryItem, 'src'> & {
  src: string
  imageBlob?: Blob
}

/**
 * 把记录拆成「索引元数据」与「二进制 blob」。
 * 异步：data URL 解码交给浏览器原生实现，见 dataUrlToBlob。
 */
async function splitItem(item: GalleryItem): Promise<StoredGalleryRecord> {
  const blob = await dataUrlToBlob(item.src)
  if (blob) return { ...item, src: '', imageBlob: blob }
  return { ...item, src: '' }
}

/**
 * data URL → Blob。
 *
 * 用 fetch(dataUrl) 而不是 atob + 逐字节循环：
 * 一张 1024×1024 PNG 的 base64 约 2MB，手工 atob 再循环 150 万次会**卡死主线程**，
 * 页面直接无响应。fetch 走浏览器原生解码路径，异步且快得多。
 */
async function dataUrlToBlob(dataUrl: string): Promise<Blob | null> {
  if (!dataUrl.startsWith('data:') || !dataUrl.includes(',')) return null
  try {
    const response = await fetch(dataUrl)
    return await response.blob()
  } catch {
    return null
  }
}

/** Blob → data URL */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * 还原成完整条目（含 src）。
 * fallback 为索引中的元数据；stored 为 IndexedDB 中的记录（含 imageBlob）。
 */
async function hydrateItem(stored: unknown, fallback: GalleryItem): Promise<GalleryItem | null> {
  if (!stored || typeof stored !== 'object') {
    return fallback.src ? { ...fallback } : null
  }
  const record = stored as Record<string, unknown>
  let src = typeof record.src === 'string' && record.src ? record.src : ''

  if (!src && record.imageBlob instanceof Blob) {
    try {
      src = await blobToDataUrl(record.imageBlob)
    } catch {
      src = ''
    }
  }
  if (!src) return null

  return {
    id: typeof record.id === 'string' ? record.id : fallback.id,
    // 从条目自身读取，兼容早期把 kind 硬编码成 edit 的数据
    kind: record.kind === 'generate' ? 'generate' : 'edit',
    src,
    prompt: typeof record.prompt === 'string' ? record.prompt : fallback.prompt,
    model: typeof record.model === 'string' ? record.model : fallback.model,
    size: (record.size as GalleryItem['size']) ?? fallback.size,
    quality: (record.quality as GalleryItem['quality']) ?? fallback.quality,
    format: (record.format as GalleryItem['format']) ?? fallback.format,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : fallback.createdAt,
    aspect: (record.aspect as GalleryItem['aspect']) ?? fallback.aspect,
    resolution: (record.resolution as GalleryItem['resolution']) ?? fallback.resolution,
    channelId:
      typeof record.channelId === 'string'
        ? record.channelId
        : fallback.channelId,
  }
}

/** 剥掉 src，只留可入索引的元数据 */
function toIndexMeta(item: GalleryItem): Omit<GalleryItem, 'src'> {
  const { src: _src, ...rest } = item
  void _src
  return rest
}

export function fileSnapshot(file: File): StoredFile {
  return {
    blob: file,
    name: file.name,
    type: file.type,
    lastModified: file.lastModified,
  }
}

export function fileToDataUrl(file: File): Promise<string> {
  return blobToDataUrl(file)
}

export { blobToDataUrl }

export function snapshotToFile(stored: StoredFile): File {
  return new File([stored.blob], stored.name || 'image.png', {
    type: stored.type || stored.blob.type,
    lastModified: Number.isFinite(stored.lastModified) ? stored.lastModified : Date.now(),
  })
}

// ------------------------------------------------------ 索引 / 草稿 序列化

function parseIndex(raw: unknown): GalleryIndex | null {
  if (Array.isArray(raw)) {
    return { items: raw.slice(0, GALLERY_LIMIT) as GalleryIndex['items'], updatedAt: '', clearEpoch: '' }
  }
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (!Array.isArray(record.items)) return null
  return {
    items: record.items.slice(0, GALLERY_LIMIT) as GalleryIndex['items'],
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
    clearEpoch: typeof record.clearEpoch === 'string' ? record.clearEpoch : '',
    destructiveRevision:
      typeof record.destructiveRevision === 'string' ? record.destructiveRevision : undefined,
  }
}

/** 索引是否比某个时间戳新 */
function isNewerThan(index: GalleryIndex | null, timestamp: string): boolean {
  if (!index) return true
  if (!timestamp) return true
  return index.updatedAt > timestamp
}

export function countClamp(value: number, max: number): number {
  const cap = Number.isFinite(max) && max > 0 ? Math.max(1, Math.floor(max)) : Number.MAX_SAFE_INTEGER
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return 1
  return Math.min(cap, Math.max(1, Math.floor(num)))
}

// 导出给 store 使用的存储操作

export const storage = {
  readEpoch,
  parseEpoch,
  writeEpoch,
  matchesEpoch,
  readEpochTagged,
  purgeStaleMetadata,

  idbAvailable,
  idbRead,
  idbPut,
  idbDelete,
  idbReadEpoch,
  idbReset,

  parseIndex,
  isNewerThan,
  splitItem,
  toIndexMeta,
  hydrateItem,
  dataUrlToBlob,
  blobToDataUrl,

  // 键名常量（store 需要直接操作索引时使用）
  LS_GALLERY_INDEX,
  LS_GALLERY_LEGACY,
  LS_GALLERY_META,
  LS_GALLERY_PENDING_DELETE,
  LS_DRAFT,
  LS_DRAFT_METADATA,
  LS_SOURCE_FILE,
  LS_REFERENCE_FILES,
  LS_MASK_FILE,
  LS_CLEAR_EPOCH,
  LS_CHECKPOINT,
  ITEM_PREFIX,
}

export function itemKey(id: string): string {
  return `${ITEM_PREFIX}${id}`
}

export type { DraftState, GalleryIndex, GalleryItem, StoredFile }
