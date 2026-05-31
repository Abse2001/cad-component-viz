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
  makeAxisBadges,
  makeAxesToBadgePositions,
  makeBoard,
  makeBoardNormalArrow,
  makeGrid,
  makeHoverMarker,
} from "../lib/scene"
import { useCadGeometry } from "./useCadGeometry"
import { useDebouncedValue } from "./useDebouncedValue"
import type { ModelSource } from "../app/types"
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
  summary: ViewerSummary
}

interface UseCadViewerParams {
  cad: Required<CadComponentInput>
  boardThickness: number
  localModelFile: File | null
  showBoard: boolean
}

function formatVector3(vector: THREE.Vector3) {
  return `(${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}, ${vector.z.toFixed(2)})`
}

export function useCadViewer({
  cad,
  boardThickness,
  localModelFile,
  showBoard,
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
  const { model: loadedModel, status, message } = useCadGeometry(modelSource)
  const geometry = loadedModel?.geometry ?? fallbackGeometry
  const geometryBounds = useMemo(() => getGeometryBounds(geometry), [geometry])
  const placement = useMemo(
    () => computePlacement(debouncedCad, geometryBounds.boundingBox),
    [debouncedCad, geometryBounds.boundingBox],
  )
  const sceneBounds = useMemo(() => {
    const transform = new THREE.Matrix4().compose(
      placement.translation,
      new THREE.Quaternion().setFromEuler(placement.rotation),
      new THREE.Vector3(1, 1, 1),
    )
    const bounds = geometryBounds.boundingBox.clone().applyMatrix4(transform)

    if (showBoard) {
      bounds.union(
        new THREE.Box3(
          new THREE.Vector3(-28, -28, -debouncedBoardThickness / 2),
          new THREE.Vector3(28, 28, debouncedBoardThickness / 2),
        ),
      )
    }

    return bounds
  }, [
    debouncedBoardThickness,
    geometryBounds.boundingBox,
    placement.rotation,
    placement.translation,
    showBoard,
  ])

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
          ? "Processing geometry"
          : "Using size box"

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
    showBoard,
    status,
  ])

  const buildScene = useMemo<SceneBuildFn>(
    () => (scene) => {
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
        `Cad Component Position ${formatVector3(boardPosition)}`,
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
      const placedBounds = geometryBounds.boundingBox
        .clone()
        .applyMatrix4(placed.matrixWorld)

      scene.add(makeAxesToBadgePositions(placedBounds, placement.rotation))
      scene.add(makeAxisBadges(placedBounds, placement.rotation))
      scene.add(
        makeBoardNormalArrow(
          modelOriginWorld,
          debouncedCad.model_board_normal_direction,
        ),
      )

      return {
        hoverTargets: [boardPositionMarker.target, modelOriginMarker.target],
        overlayObjects: [boardPositionMarker.group, modelOriginMarker.group],
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
      placement.modelOrigin,
      placement.rotation,
      placement.translation,
      showBoard,
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
    summary,
  }
}
