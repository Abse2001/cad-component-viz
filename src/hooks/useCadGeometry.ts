import { useEffect, useState } from "react"
import * as THREE from "three"
import {
  detectModelFormat,
  disposeModelObject,
  fetchModelBuffer,
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
  downloadMs,
  parseMs,
  totalMs,
}: {
  model: NonNullable<CadGeometryState["model"]>
  format: string
  source: ModelSource
  buffer?: ArrayBuffer
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
    fileSizeBytes: getFileSize(source, buffer),
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
        const model = await parseModelFromUrl(source.value, format, {
          signal: controller.signal,
          onProgress: ({ loaded, total }) => {
            downloadFinishedAt = performance.now()
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
        downloadMs,
        parseMs: performance.now() - parseStartedAt,
      }
    }

    loadGeometry()
      .then(
        ({ model, format: resolvedFormat, buffer, downloadMs, parseMs }) => {
          if (disposed) {
            model.geometry.dispose()
            disposeModelObject(model.object)
            return
          }

          const totalMs = performance.now() - startedAt
          setState({
            model,
            status: "ready",
            progress: null,
            stats: getModelStats({
              model,
              format: resolvedFormat,
              source,
              buffer,
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
