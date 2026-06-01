import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import {
  createControls,
  createRenderer,
  fitRenderer,
  type HoverTarget,
} from "../lib/scene"
import {
  areCompassPointsEqual,
  AxisCompass,
  getCompassPoints,
} from "./viewer/AxisCompass"
import {
  configureCameraForView,
  createViewportCamera,
} from "./viewer/cameraView"
import { ViewportToolbar } from "./viewer/ViewportToolbar"
import type {
  AxisViewPreset,
  CompassPoint,
  ProjectionMode,
  ViewPreset,
} from "./viewer/viewerTypes"

export type SceneBuildResult = {
  hoverTargets?: HoverTarget[]
  overlayObjects?: THREE.Object3D[]
}

export type SceneBuildFn = (scene: THREE.Scene) => SceneBuildResult | void

export interface SceneCanvasProps {
  title: string
  subtitle: string
  up: THREE.Vector3
  sceneBounds: THREE.Box3
  buildScene: SceneBuildFn
}

function disposeScene(scene: THREE.Scene | null) {
  if (!scene) {
    return
  }

  scene.traverse((object: THREE.Object3D) => {
    if (!(object instanceof THREE.Mesh)) {
      return
    }

    object.geometry.dispose()
    if (Array.isArray(object.material)) {
      for (const material of object.material) {
        material.dispose()
      }
    } else {
      object.material.dispose()
    }
  })

  scene.clear()
}

export function SceneCanvas({
  title,
  subtitle,
  up,
  sceneBounds,
  buildScene,
}: SceneCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.Camera | null>(null)
  const controlsRef = useRef<ReturnType<typeof createControls> | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const overlaySceneRef = useRef<THREE.Scene | null>(null)
  const hoverTargetsRef = useRef<HoverTarget[]>([])
  const [projection, setProjection] = useState<ProjectionMode>("orthographic")
  const [viewPreset, setViewPreset] = useState<ViewPreset>("corner")
  const [fitRequest, setFitRequest] = useState(0)
  const [hovered, setHovered] = useState<{
    x: number
    y: number
    lines: string[]
  } | null>(null)
  const [compassPoints, setCompassPoints] = useState<Record<
    AxisViewPreset,
    CompassPoint
  > | null>(null)
  const compassPointsRef = useRef<Record<AxisViewPreset, CompassPoint> | null>(
    null,
  )
  const sceneBoundsRef = useRef(sceneBounds)

  useEffect(() => {
    sceneBoundsRef.current = sceneBounds
  }, [sceneBounds])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const renderer = createRenderer(canvas)
    renderer.autoClear = false

    const camera = createViewportCamera({
      canvas,
      projection,
      up,
      viewPreset,
    })
    const controls = createControls(camera, canvas)
    const scene = new THREE.Scene()
    const overlayScene = new THREE.Scene()
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    rendererRef.current = renderer
    cameraRef.current = camera
    controlsRef.current = controls
    sceneRef.current = scene
    overlaySceneRef.current = overlayScene

    const resize = () => {
      fitRenderer(renderer, camera, canvas)
      configureCameraForView({
        camera,
        canvas,
        controls,
        sceneBounds: sceneBoundsRef.current,
        up,
        viewPreset,
      })
    }
    resize()
    const updateCompass = () => {
      const nextCompassPoints = getCompassPoints(camera)
      if (areCompassPointsEqual(compassPointsRef.current, nextCompassPoints)) {
        return
      }

      compassPointsRef.current = nextCompassPoints
      setCompassPoints(nextCompassPoints)
    }
    updateCompass()

    const updateHover = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const intersections = raycaster.intersectObjects(
        hoverTargetsRef.current.map((target) => target.object),
        true,
      )

      if (intersections.length === 0) {
        setHovered(null)
        canvas.style.cursor = "default"
        return
      }

      const hit = hoverTargetsRef.current.find((target) =>
        intersections.some(
          (intersection) =>
            intersection.object === target.object ||
            target.object.children.includes(intersection.object),
        ),
      )

      if (!hit) {
        setHovered(null)
        canvas.style.cursor = "default"
        return
      }

      const projected = hit.position.clone().project(camera)
      setHovered({
        x: ((projected.x + 1) / 2) * rect.width,
        y: ((-projected.y + 1) / 2) * rect.height - 12,
        lines: hit.lines,
      })
      canvas.style.cursor = "pointer"
    }

    const onPointerMove = (event: PointerEvent) => {
      updateHover(event.clientX, event.clientY)
    }

    const onPointerLeave = () => {
      setHovered(null)
      canvas.style.cursor = "default"
    }

    canvas.addEventListener("pointermove", onPointerMove)
    canvas.addEventListener("pointerleave", onPointerLeave)

    let animationFrame = 0
    const render = () => {
      animationFrame = window.requestAnimationFrame(render)
      controls.update()
      updateCompass()
      renderer.clear()
      renderer.render(scene, camera)
      renderer.clearDepth()
      renderer.render(overlayScene, camera)
    }
    render()

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      observer.disconnect()
      canvas.removeEventListener("pointermove", onPointerMove)
      canvas.removeEventListener("pointerleave", onPointerLeave)
      controls.dispose()
      renderer.dispose()
      disposeScene(scene)
      disposeScene(overlayScene)
      hoverTargetsRef.current = []
      compassPointsRef.current = null
      rendererRef.current = null
      cameraRef.current = null
      controlsRef.current = null
      sceneRef.current = null
      overlaySceneRef.current = null
      setCompassPoints(null)
    }
  }, [projection, up, viewPreset])

  useEffect(() => {
    const canvas = canvasRef.current
    const renderer = rendererRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!canvas || !renderer || !camera || !controls) {
      return
    }

    fitRenderer(renderer, camera, canvas)
    configureCameraForView({
      camera,
      canvas,
      controls,
      sceneBounds: sceneBoundsRef.current,
      up,
      viewPreset,
    })
  }, [fitRequest])

  useEffect(() => {
    const scene = sceneRef.current
    const overlayScene = overlaySceneRef.current
    if (!scene || !overlayScene) {
      return
    }

    disposeScene(scene)
    disposeScene(overlayScene)
    const buildResult = buildScene(scene)
    hoverTargetsRef.current = buildResult?.hoverTargets ?? []

    for (const object of buildResult?.overlayObjects ?? []) {
      overlayScene.add(object)
    }
  }, [buildScene, projection, up, viewPreset])

  return (
    <section className="viewport">
      <header className="viewport-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <ViewportToolbar
          projection={projection}
          viewPreset={viewPreset}
          onFit={() => setFitRequest((current) => current + 1)}
          onProjectionToggle={() =>
            setProjection((current) =>
              current === "perspective" ? "orthographic" : "perspective",
            )
          }
          onViewPresetChange={setViewPreset}
        />
      </header>
      <div className="viewport-body">
        <canvas ref={canvasRef} />
        <AxisCompass
          compassPoints={compassPoints}
          viewPreset={viewPreset}
          onViewPresetChange={setViewPreset}
        />
        {hovered ? (
          <div
            className="hover-label"
            style={{ left: hovered.x, top: hovered.y }}
          >
            {hovered.lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
