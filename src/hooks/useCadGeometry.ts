import { useEffect, useState } from "react"
import * as THREE from "three"
import {
  cloneModelObject,
  detectModelFormat,
  disposeModelObject,
  fetchModelBuffer,
  type LoadedModel,
  type ModelFormat,
  parseModelFromBuffer,
  parseModelFromUnknownBuffer,
  parseModelFromUrl,
} from "../lib/cad"
import { parseModelFromBufferInWorker } from "../lib/cadWorker"
import { getCadGeometryIdleMessage } from "../app/utils/modelSourceMessageUtils"
import type { CadGeometryState, CadModelStats, ModelSource } from "../app/types"

function formatProgressMessage(
  formatLabel: string,
  loaded: number,
  total: number | null,
) {
  if (total && total > 0) {
    return `Downloading ${formatLabel} model ${Math.round((loaded / total) * 100)}%...`
  }

  const loadedMb = loaded / (1024 * 1024)
  return `Downloading ${formatLabel} model ${loadedMb.toFixed(1)} MB...`
}

function getFileSize(source: ModelSource, buffer?: ArrayBuffer) {
  if (source.kind === "file") {
    return source.file.size
  }

  return buffer?.byteLength ?? null
}

interface CachedModelEntry {
  model: LoadedModel
  format: ModelFormat
  fileSizeBytes: number | null
}

const MODEL_CACHE_LIMIT = 8
const modelCache = new Map<string, CachedModelEntry>()

function getModelCacheKey(source: ModelSource) {
  if (source.kind === "url") {
    return `url:${source.value.trim()}`
  }

  if (source.kind === "file") {
    return `file:${source.file.name}:${source.file.size}:${source.file.lastModified}`
  }

  return null
}

function cloneLoadedModel(model: LoadedModel): LoadedModel {
  return {
    geometry: model.geometry.clone(),
    object: cloneModelObject(model.object),
  }
}

function disposeLoadedModel(model: LoadedModel) {
  model.geometry.dispose()
  disposeModelObject(model.object)
}

function getCachedModel(cacheKey: string | null) {
  if (!cacheKey) {
    return null
  }

  const entry = modelCache.get(cacheKey)
  if (!entry) {
    return null
  }

  modelCache.delete(cacheKey)
  modelCache.set(cacheKey, entry)
  return entry
}

function setCachedModel(cacheKey: string | null, entry: CachedModelEntry) {
  if (!cacheKey) {
    return
  }

  const previous = modelCache.get(cacheKey)
  if (previous) {
    disposeLoadedModel(previous.model)
    modelCache.delete(cacheKey)
  }

  modelCache.set(cacheKey, entry)

  while (modelCache.size > MODEL_CACHE_LIMIT) {
    const oldestKey = modelCache.keys().next().value
    if (!oldestKey) {
      break
    }
    const oldest = modelCache.get(oldestKey)
    if (oldest) {
      disposeLoadedModel(oldest.model)
    }
    modelCache.delete(oldestKey)
  }
}

function getTriangleCount(geometry: THREE.BufferGeometry) {
  const index = geometry.getIndex()
  if (index) {
    return Math.floor(index.count / 3)
  }

  const position = geometry.getAttribute("position")
  return position ? Math.floor(position.count / 3) : 0
}

function getModelStats({
  model,
  format,
  source,
  buffer,
  fileSizeBytes,
  downloadMs,
  parseMs,
  totalMs,
}: {
  model: NonNullable<CadGeometryState["model"]>
  format: string
  source: ModelSource
  buffer?: ArrayBuffer
  fileSizeBytes?: number | null
  downloadMs: number | null
  parseMs: number
  totalMs: number
}): CadModelStats {
  let meshCount = 0
  let triangleCount = 0
  let vertexCount = 0

  model.object.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return
    }

    meshCount += 1
    const position = object.geometry.getAttribute("position")
    vertexCount += position?.count ?? 0
    triangleCount += getTriangleCount(object.geometry)
  })

  if (meshCount === 0) {
    const position = model.geometry.getAttribute("position")
    vertexCount = position?.count ?? 0
    triangleCount = getTriangleCount(model.geometry)
  }

  if (!model.geometry.boundingBox) {
    model.geometry.computeBoundingBox()
  }
  const size =
    model.geometry.boundingBox?.getSize(new THREE.Vector3()) ??
    new THREE.Vector3()

  return {
    format: format.toUpperCase(),
    meshCount,
    vertexCount,
    triangleCount,
    bounds: {
      x: size?.x ?? 0,
      y: size?.y ?? 0,
      z: size?.z ?? 0,
    },
    fileSizeBytes: fileSizeBytes ?? getFileSize(source, buffer),
    downloadMs,
    parseMs,
    totalMs,
  }
}

export function useCadGeometry(source: ModelSource): CadGeometryState {
  const [state, setState] = useState<CadGeometryState>({
    model: null,
    status: source.kind === "none" ? "fallback" : "loading",
    message: getCadGeometryIdleMessage(source),
    progress: null,
    stats: null,
  })

  useEffect(() => {
    let disposed = false

    if (source.kind === "none") {
      setState({
        model: null,
        status: "fallback",
        message: "Using fallback box from size.",
        progress: null,
        stats: null,
      })
      return
    }

    const sourceName = source.kind === "file" ? source.file.name : source.value
    const format = detectModelFormat(sourceName)
    const formatLabel = format?.toUpperCase() ?? "model"
    const cacheKey = getModelCacheKey(source)
    const cached = getCachedModel(cacheKey)
    if (cached) {
      const model = cloneLoadedModel(cached.model)
      setState({
        model,
        status: "ready",
        progress: null,
        stats: getModelStats({
          model,
          format: cached.format,
          source,
          fileSizeBytes: cached.fileSizeBytes,
          downloadMs: null,
          parseMs: 0,
          totalMs: 0,
        }),
        message:
          source.kind === "file"
            ? `${cached.format.toUpperCase()} loaded from cache for ${source.file.name}.`
            : `${cached.format.toUpperCase()} loaded from cache.`,
      })
      return
    }

    setState({
      model: null,
      status: "loading",
      message: format
        ? `Loading ${formatLabel} model...`
        : "Loading model and detecting format...",
      progress: null,
      stats: null,
    })

    const controller = new AbortController()
    const startedAt = performance.now()
    const loadGeometry = async () => {
      if (source.kind === "url" && (format === "gltf" || format === "glb")) {
        const downloadStartedAt = performance.now()
        let downloadFinishedAt = downloadStartedAt
        let loadedBytes = 0
        const model = await parseModelFromUrl(source.value, format, {
          signal: controller.signal,
          onProgress: ({ loaded, total }) => {
            downloadFinishedAt = performance.now()
            loadedBytes = loaded
            if (disposed || controller.signal.aborted) {
              return
            }
            setState((current) => ({
              ...current,
              status: "loading",
              message: formatProgressMessage(formatLabel, loaded, total),
              progress: total && total > 0 ? loaded / total : null,
            }))
          },
        })
        const finishedAt = performance.now()
        return {
          model,
          format,
          buffer: undefined,
          fileSizeBytes: loadedBytes || null,
          downloadMs: downloadFinishedAt - downloadStartedAt,
          parseMs: finishedAt - downloadFinishedAt,
        }
      }

      const downloadStartedAt = performance.now()
      const buffer =
        source.kind === "file"
          ? await source.file.arrayBuffer()
          : await fetchModelBuffer(source.value, {
              signal: controller.signal,
              onProgress: ({ loaded, total }) => {
                if (disposed || controller.signal.aborted) {
                  return
                }
                setState((current) => ({
                  ...current,
                  status: "loading",
                  message: formatProgressMessage(formatLabel, loaded, total),
                  progress: total && total > 0 ? loaded / total : null,
                }))
              },
            })
      const downloadMs =
        source.kind === "url" ? performance.now() - downloadStartedAt : null

      if (format) {
        if (format === "gltf" || format === "glb") {
          setState((current) => ({
            ...current,
            status: "loading",
            message: `Parsing ${formatLabel} model...`,
            progress: null,
          }))
          const parseStartedAt = performance.now()
          return {
            model: await parseModelFromBuffer(buffer, format),
            format,
            buffer,
            fileSizeBytes: buffer.byteLength,
            downloadMs,
            parseMs: performance.now() - parseStartedAt,
          }
        }

        setState((current) => ({
          ...current,
          status: "loading",
          message: `Parsing ${formatLabel} model off the main thread...`,
          progress: null,
        }))
        const parseStartedAt = performance.now()
        const result = await parseModelFromBufferInWorker(buffer, format, {
          signal: controller.signal,
        })
        return {
          ...result,
          buffer,
          fileSizeBytes: buffer.byteLength,
          downloadMs,
          parseMs: performance.now() - parseStartedAt,
        }
      }

      setState((current) => ({
        ...current,
        status: "loading",
        message: "Detecting model format...",
        progress: null,
      }))
      const parseStartedAt = performance.now()
      const result = await parseModelFromUnknownBuffer(buffer)
      return {
        ...result,
        buffer,
        fileSizeBytes: buffer.byteLength,
        downloadMs,
        parseMs: performance.now() - parseStartedAt,
      }
    }

    loadGeometry()
      .then(
        ({
          model,
          format: resolvedFormat,
          buffer,
          fileSizeBytes,
          downloadMs,
          parseMs,
        }) => {
          if (disposed) {
            disposeLoadedModel(model)
            return
          }

          const resolvedFileSizeBytes =
            fileSizeBytes ?? getFileSize(source, buffer)
          setCachedModel(cacheKey, {
            model,
            format: resolvedFormat,
            fileSizeBytes: resolvedFileSizeBytes,
          })
          const displayModel = cloneLoadedModel(model)
          const totalMs = performance.now() - startedAt
          setState({
            model: displayModel,
            status: "ready",
            progress: null,
            stats: getModelStats({
              model: displayModel,
              format: resolvedFormat,
              source,
              buffer,
              fileSizeBytes: resolvedFileSizeBytes,
              downloadMs,
              parseMs: parseMs ?? totalMs,
              totalMs,
            }),
            message:
              source.kind === "file"
                ? `${resolvedFormat.toUpperCase()} loaded from ${source.file.name}.`
                : `${resolvedFormat.toUpperCase()} loaded successfully.`,
          })
        },
      )
      .catch((error: unknown) => {
        if (disposed || controller.signal.aborted) {
          return
        }

        setState({
          model: null,
          status: "fallback",
          progress: null,
          stats: null,
          message:
            error instanceof Error
              ? `${error.message}. Falling back to size box.`
              : "Failed to load model. Falling back to size box.",
        })
      })

    return () => {
      disposed = true
      controller.abort()
    }
  }, [source])

  useEffect(
    () => () => {
      state.model?.geometry.dispose()
      disposeModelObject(state.model?.object ?? null)
    },
    [state.model],
  )

  return state
}
