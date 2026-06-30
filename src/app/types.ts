import type { LoadedModel } from "../lib/cad"

export type ModelSource =
  | { kind: "none" }
  | { kind: "url"; value: string }
  | { kind: "file"; file: File }

export type AppMode = "landing" | "workspace"

export type CadGeometryStatus = "idle" | "loading" | "ready" | "fallback"

export interface CadGeometryState {
  model: LoadedModel | null
  status: CadGeometryStatus
  message: string
  progress: number | null
  stats: CadModelStats | null
}

export interface CadModelStats {
  format: string
  meshCount: number
  vertexCount: number
  triangleCount: number
  bounds: {
    x: number
    y: number
    z: number
  }
  fileSizeBytes: number | null
  downloadMs: number | null
  parseMs: number
  totalMs: number
}

export interface CadModelWarning {
  id: string
  severity: "warning" | "error"
  title: string
  message: string
}
