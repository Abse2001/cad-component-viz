import { useMemo } from "react"
import * as THREE from "three"
import {
  buildFallbackGeometry,
  cloneModelObject,
  computePlacement,
  getGeometryBounds,
} from "../lib/cad"
import {
  addDefaultLights,
  makeBoard,
  makeBoardNormalArrow,
  makeDimensionOverlay,
  makeGrid,
  makeHoverMarker,
  makePlacementRelationshipOverlay,
} from "../lib/scene"
import { useCadGeometry } from "./useCadGeometry"
import { useDebouncedValue } from "./useDebouncedValue"
import type { CadModelStats, CadModelWarning, ModelSource } from "../app/types"
import type { CadComponentInput } from "../types"
import type { SceneBuildFn } from "../components/SceneCanvas"

const BOARD_UP_VECTOR = new THREE.Vector3(0, 0, 1)

export interface ViewerSummary {
  statusClass: "ok" | "loading" | "warning"
  statusLabel: string
  statusMeta: string
  sourceType: string
  sourceValue: string
  shortSourceValue: string
  boardLabel: string
}

export interface UseCadViewerResult {
  title: string
  subtitle: string
  up: THREE.Vector3
  sceneBounds: THREE.Box3
  buildScene: SceneBuildFn
  status: "idle" | "loading" | "ready" | "fallback"
  message: string
  progress: number | null
  summary: ViewerSummary
  modelStats: CadModelStats | null
  warnings: CadModelWarning[]
}

interface UseCadViewerParams {
  cad: Required<CadComponentInput>
  boardThickness: number
  localModelFile: File | null
  showBoard: boolean
  showPlacement: boolean
}

function formatVector3(vector: THREE.Vector3) {
  return `(${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}, ${vector.z.toFixed(2)})`
}

function hasMissingNormals(model: THREE.Object3D | null) {
  if (!model) {
    return false
  }

  let missingNormals = false
  model.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      !object.geometry.getAttribute("normal")
    ) {
      missingNormals = true
    }
  })
  return missingNormals
}

function getModelWarnings({
  source,
  status,
  message,
  stats,
  model,
  placedBounds,
  boardThickness,
}: {
  source: ModelSource
  status: UseCadViewerResult["status"]
  message: string
  stats: CadModelStats | null
  model: THREE.Object3D | null
  placedBounds: THREE.Box3
  boardThickness: number
}): CadModelWarning[] {
  const warnings: CadModelWarning[] = []

  if (source.kind !== "none" && status === "fallback") {
    warnings.push({
      id: "model-load-failed",
      severity: "error",
      title: "Model load failed",
      message,
    })
  }

  if (!stats) {
    return warnings
  }

  const maxBound = Math.max(stats.bounds.x, stats.bounds.y, stats.bounds.z)
  const minBound = Math.min(stats.bounds.x, stats.bounds.y, stats.bounds.z)
  if (stats.meshCount === 0 || stats.triangleCount === 0) {
    warnings.push({
      id: "no-mesh",
      severity: "error",
      title: "No mesh triangles",
      message: "The imported model does not contain visible triangle geometry.",
    })
  }

  if (maxBound <= 0.001 || minBound <= 0.001) {
    warnings.push({
      id: "zero-bounds",
      severity: "error",
      title: "Zero-size bounds",
      message: "One or more model dimensions are effectively zero.",
    })
  } else if (maxBound > 1000) {
    warnings.push({
      id: "large-scale",
      severity: "warning",
      title: "Very large model",
      message: "The model is over 1000 mm across. Check units or import scale.",
    })
  } else if (maxBound < 0.25) {
    warnings.push({
      id: "tiny-scale",
      severity: "warning",
      title: "Very small model",
      message:
        "The model is under 0.25 mm across. Check units or import scale.",
    })
  }

  if (hasMissingNormals(model)) {
    warnings.push({
      id: "missing-normals",
      severity: "warning",
      title: "Missing normals",
      message:
        "Some meshes do not provide normals; shading may look incorrect.",
    })
  }

  const boardTop = boardThickness / 2
  if (placedBounds.min.z < boardTop - 0.01) {
    warnings.push({
      id: "below-board",
      severity: "warning",
      title: "Model below board surface",
      message: `Lowest point is ${(boardTop - placedBounds.min.z).toFixed(2)} mm below the board top.`,
    })
  }

  return warnings
}

export function useCadViewer({
  cad,
  boardThickness,
  localModelFile,
  showBoard,
  showPlacement,
}: UseCadViewerParams): UseCadViewerResult {
  const debouncedCad = useDebouncedValue(cad, 350)
  const debouncedBoardThickness = useDebouncedValue(boardThickness, 350)
  const fileModelSource = useMemo<ModelSource | null>(
    () => (localModelFile ? { kind: "file", file: localModelFile } : null),
    [localModelFile],
  )
  const urlModelSource = useMemo<ModelSource>(() => {
    const modelUrl = debouncedCad.model_obj_url.trim()
    if (modelUrl) {
      return { kind: "url", value: modelUrl }
    }

    return { kind: "none" }
  }, [debouncedCad.model_obj_url])
  const modelSource = fileModelSource ?? urlModelSource
  const fallbackGeometry = useMemo(
    () => buildFallbackGeometry(debouncedCad),
    [debouncedCad],
  )
  const {
    model: loadedModel,
    status,
    message,
    progress,
    stats,
  } = useCadGeometry(modelSource)
  const geometry = loadedModel?.geometry ?? fallbackGeometry
  const geometryBounds = useMemo(() => getGeometryBounds(geometry), [geometry])
  const placement = useMemo(
    () => computePlacement(debouncedCad, geometryBounds.boundingBox),
    [debouncedCad, geometryBounds.boundingBox],
  )
  const placedModelBounds = useMemo(() => {
    const transform = new THREE.Matrix4().compose(
      placement.translation,
      new THREE.Quaternion().setFromEuler(placement.rotation),
      new THREE.Vector3(1, 1, 1),
    )
    return geometryBounds.boundingBox.clone().applyMatrix4(transform)
  }, [geometryBounds.boundingBox, placement.rotation, placement.translation])
  const sceneBounds = useMemo(() => {
    const bounds = placedModelBounds.clone()

    if (showBoard) {
      bounds.union(
        new THREE.Box3(
          new THREE.Vector3(-28, -28, -debouncedBoardThickness / 2),
          new THREE.Vector3(28, 28, debouncedBoardThickness / 2),
        ),
      )
    }

    return bounds
  }, [debouncedBoardThickness, placedModelBounds, showBoard])

  const summary = useMemo<ViewerSummary>(() => {
    const sourceType = localModelFile
      ? "Local file"
      : cad.model_obj_url.trim()
        ? "Remote model"
        : "Fallback geometry"
    const sourceValue =
      localModelFile?.name || cad.model_obj_url.trim() || "Size box"
    const shortSourceValue =
      sourceValue.length > 28 ? `${sourceValue.slice(0, 28)}...` : sourceValue
    const statusLabel =
      status === "ready"
        ? "Ready"
        : status === "loading"
          ? "Loading"
          : "Fallback"
    const statusMeta =
      status === "ready"
        ? loadedModel
          ? "Model loaded"
          : "Fallback shape"
        : status === "loading"
          ? message
          : message

    return {
      statusClass:
        status === "ready"
          ? "ok"
          : status === "loading"
            ? "loading"
            : "warning",
      statusLabel,
      statusMeta,
      sourceType,
      sourceValue,
      shortSourceValue,
      boardLabel: showBoard ? "Visible" : "Hidden",
    }
  }, [
    boardThickness,
    cad.model_obj_url,
    localModelFile,
    loadedModel,
    message,
    showBoard,
    status,
  ])

  const buildScene = useMemo<SceneBuildFn>(
    () =>
      (scene, { showDimensions }) => {
        addDefaultLights(scene)
        scene.add(makeGrid(90, 36, "z+"))

        if (showBoard) {
          scene.add(makeBoard(debouncedBoardThickness))
        }

        const placed = new THREE.Group()
        placed.rotation.copy(placement.rotation)
        placed.position.copy(placement.translation)

        if (loadedModel) {
          placed.add(cloneModelObject(loadedModel.object))
        } else {
          placed.add(
            new THREE.Mesh(
              geometry.clone(),
              new THREE.MeshPhongMaterial({
                color: 0x79a8ff,
                transparent: true,
                opacity: 0.84,
                side: THREE.DoubleSide,
              }),
            ),
          )
        }

        scene.add(placed)
        placed.updateMatrixWorld(true)

        const boardPosition = new THREE.Vector3(
          debouncedCad.position.x,
          debouncedCad.position.y,
          debouncedCad.position.z,
        )
        const boardPositionMarker = makeHoverMarker(boardPosition, [
          `Position ${formatVector3(boardPosition)}`,
          `Anchor Alignment: ${debouncedCad.anchor_alignment}`,
        ])
        const modelOriginWorld = placement.modelOrigin
          .clone()
          .applyEuler(placement.rotation)
          .add(placement.translation)
        const modelOriginMarker = makeHoverMarker(modelOriginWorld, [
          `Model Origin ${formatVector3(modelOriginWorld)}`,
          `Model Origin Alignment: ${debouncedCad.model_origin_alignment}`,
        ])
        const anchorWorld = placement.anchorPoint
          .clone()
          .applyEuler(placement.rotation)
          .add(placement.translation)
        const anchorMarker = makeHoverMarker(
          anchorWorld,
          [
            `Anchor Point ${formatVector3(anchorWorld)}`,
            `Anchor Alignment: ${debouncedCad.anchor_alignment}`,
          ],
          0xf59e0b,
        )
        const placedBounds = geometryBounds.boundingBox
          .clone()
          .applyMatrix4(placed.matrixWorld)

        if (showDimensions) {
          scene.add(makeDimensionOverlay(placedBounds))
        }
        if (showPlacement) {
          scene.add(
            makePlacementRelationshipOverlay({
              modelOriginWorld,
              anchorWorld,
              componentPosition: boardPosition,
            }),
          )
        }
        scene.add(
          makeBoardNormalArrow(
            modelOriginWorld,
            debouncedCad.model_board_normal_direction,
          ),
        )

        return {
          hoverTargets: [
            boardPositionMarker.target,
            modelOriginMarker.target,
            anchorMarker.target,
          ],
          overlayObjects: [
            boardPositionMarker.group,
            modelOriginMarker.group,
            anchorMarker.group,
          ],
        }
      },
    [
      debouncedCad.anchor_alignment,
      debouncedCad.model_board_normal_direction,
      debouncedCad.model_origin_alignment,
      debouncedCad.position.x,
      debouncedCad.position.y,
      debouncedCad.position.z,
      debouncedBoardThickness,
      geometry,
      geometryBounds.boundingBox,
      loadedModel,
      placement.anchorPoint,
      placement.modelOrigin,
      placement.rotation,
      placement.translation,
      showBoard,
      showPlacement,
    ],
  )
  const warnings = useMemo(
    () =>
      getModelWarnings({
        source: modelSource,
        status,
        message,
        stats,
        model: loadedModel?.object ?? null,
        placedBounds: placedModelBounds,
        boardThickness: debouncedBoardThickness,
      }),
    [
      debouncedBoardThickness,
      loadedModel,
      message,
      modelSource,
      placedModelBounds,
      stats,
      status,
    ],
  )

  return {
    title: "Viewer",
    subtitle:
      "The model is shown in board space. Toggle the green board overlay on or off.",
    up: BOARD_UP_VECTOR,
    sceneBounds,
    buildScene,
    status,
    message,
    progress,
    summary,
    modelStats: stats,
    warnings,
  }
}
