import type { DragEventHandler, HTMLAttributes, MutableRefObject } from "react"
import { useMemo, useRef, useState } from "react"
import { normalizeCadComponent } from "../lib/cad"
import { SAMPLE_CAD_COMPONENT } from "../sampleCadComponent"
import {
  createUploadedCadComponent,
  parseCadComponentInput,
} from "../app/utils/cadComponentImportUtils"
import type { AppMode } from "../app/types"
import type { CadComponentInput } from "../types"

type CadState = Required<CadComponentInput>
type VectorKey = "model_origin_position" | "position"
type AxisKey = "x" | "y" | "z"

interface VectorUpdateInput {
  key: VectorKey
  axis: AxisKey
  value: number
}

interface AxisUpdateInput {
  axis: AxisKey
  value: number
}

export type DropTargetProps = Pick<
  HTMLAttributes<HTMLElement>,
  "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop"
>

export interface UseCadComponentEditorResult {
  mode: AppMode
  cad: CadState
  boardThickness: number
  showBoard: boolean
  showPlacement: boolean
  localModelFile: File | null
  isDragActive: boolean
  importText: string
  importError: string | null
  generatedJson: string
  landingFileInputRef: MutableRefObject<HTMLInputElement | null>
  dropTargetProps: DropTargetProps
  setMode: (mode: AppMode) => void
  setBoardThickness: (value: number) => void
  setShowBoard: (value: boolean) => void
  setShowPlacement: (value: boolean) => void
  setImportText: (value: string) => void
  updateField: <K extends keyof CadState>(key: K, value: CadState[K]) => void
  updateVector: (input: VectorUpdateInput) => void
  updateSize: (input: AxisUpdateInput) => void
  setModelUrl: (value: string) => void
  setUploadedModelFile: (file: File | null) => void
  clearLocalModelFile: () => void
  openLandingFilePicker: () => void
  loadDemoModel: () => void
  loadDroppedModel: (file: File) => void
  importJson: () => void
}

export function useCadComponentEditor(): UseCadComponentEditorResult {
  const [mode, setMode] = useState<AppMode>("landing")
  const [cad, setCad] = useState<CadState>(() =>
    normalizeCadComponent(SAMPLE_CAD_COMPONENT),
  )
  const [boardThickness, setBoardThickness] = useState(1.6)
  const [showBoard, setShowBoard] = useState(true)
  const [showPlacement, setShowPlacement] = useState(false)
  const [localModelFile, setLocalModelFile] = useState<File | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [importText, setImportText] = useState(() =>
    JSON.stringify(SAMPLE_CAD_COMPONENT, null, 2),
  )
  const [importError, setImportError] = useState<string | null>(null)
  const landingFileInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)

  const generatedJson = useMemo(() => JSON.stringify(cad, null, 2), [cad])

  const updateField = <K extends keyof CadState>(
    key: K,
    value: CadState[K],
  ) => {
    setCad((current) => ({ ...current, [key]: value }))
  }

  const updateVector = ({ key, axis, value }: VectorUpdateInput) => {
    setCad((current) => ({
      ...current,
      [key]: {
        ...current[key],
        [axis]: value,
      },
    }))
  }

  const updateSize = ({ axis, value }: AxisUpdateInput) => {
    setCad((current) => ({
      ...current,
      size: {
        ...current.size,
        [axis]: value,
      },
    }))
  }

  const applyCadState = ({
    nextCad,
    nextFile,
  }: {
    nextCad: CadState
    nextFile: File | null
  }) => {
    setCad(nextCad)
    setLocalModelFile(nextFile)
    setImportText(JSON.stringify(nextCad, null, 2))
    setImportError(null)
    setMode("workspace")
  }

  const loadDemoModel = () => {
    applyCadState({
      nextCad: normalizeCadComponent(SAMPLE_CAD_COMPONENT),
      nextFile: null,
    })
  }

  const loadDroppedModel = (file: File) => {
    applyCadState({
      nextCad: createUploadedCadComponent(file),
      nextFile: file,
    })
  }

  const setDragInactive = () => {
    dragDepthRef.current = 0
    setIsDragActive(false)
  }

  const handleDragEnter: DragEventHandler<HTMLElement> = (event) => {
    event.preventDefault()
    dragDepthRef.current += 1
    setIsDragActive(true)
  }

  const handleDragOver: DragEventHandler<HTMLElement> = (event) => {
    event.preventDefault()
    if (!isDragActive) {
      setIsDragActive(true)
    }
  }

  const handleDragLeave: DragEventHandler<HTMLElement> = (event) => {
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsDragActive(false)
    }
  }

  const handleDrop: DragEventHandler<HTMLElement> = (event) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    setDragInactive()
    if (file) {
      loadDroppedModel(file)
    }
  }

  const setModelUrl = (value: string) => {
    setLocalModelFile(null)
    updateField("model_obj_url", value)
  }

  const setUploadedModelFile = (file: File | null) => {
    setLocalModelFile(file)
    if (file) {
      updateField("model_obj_url", "")
    }
  }

  const clearLocalModelFile = () => {
    setLocalModelFile(null)
  }

  const openLandingFilePicker = () => {
    landingFileInputRef.current?.click()
  }

  const importJson = () => {
    const parsed = parseCadComponentInput(importText)
    if (!parsed.value) {
      setImportError(parsed.error ?? "Invalid JSON")
      return
    }

    setCad(normalizeCadComponent(parsed.value))
    setLocalModelFile(null)
    setImportError(null)
    setMode("workspace")
  }

  return {
    mode,
    cad,
    boardThickness,
    showBoard,
    showPlacement,
    localModelFile,
    isDragActive,
    importText,
    importError,
    generatedJson,
    landingFileInputRef,
    dropTargetProps: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
    setMode,
    setBoardThickness,
    setShowBoard,
    setShowPlacement,
    setImportText,
    updateField,
    updateVector,
    updateSize,
    setModelUrl,
    setUploadedModelFile,
    clearLocalModelFile,
    openLandingFilePicker,
    loadDemoModel,
    loadDroppedModel,
    importJson,
  }
}
