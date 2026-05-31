import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import {
  createCamera,
  createControls,
  createRenderer,
  fitRenderer,
  type HoverTarget,
} from "../lib/scene"

type ProjectionMode = "perspective" | "orthographic"
type AxisViewPreset = "x+" | "x-" | "y+" | "y-" | "z+" | "z-"
type ViewPreset = AxisViewPreset | "corner"
type CompassPoint = {
  x: number
  y: number
  z: number
}

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

const AXIS_VIEW_BUTTONS: Array<{
  preset: AxisViewPreset
  label: string
  className: string
  direction: THREE.Vector3
}> = [
  {
    preset: "x+",
    label: "X+",
    className: "axis-x-plus",
    direction: new THREE.Vector3(1, 0, 0),
  },
  {
    preset: "x-",
    label: "X-",
    className: "axis-x-minus",
    direction: new THREE.Vector3(-1, 0, 0),
  },
  {
    preset: "y+",
    label: "Y+",
    className: "axis-y-plus",
    direction: new THREE.Vector3(0, 1, 0),
  },
  {
    preset: "y-",
    label: "Y-",
    className: "axis-y-minus",
    direction: new THREE.Vector3(0, -1, 0),
  },
  {
    preset: "z+",
    label: "Z+",
    className: "axis-z-plus",
    direction: new THREE.Vector3(0, 0, 1),
  },
  {
    preset: "z-",
    label: "Z-",
    className: "axis-z-minus",
    direction: new THREE.Vector3(0, 0, -1),
  },
]

function getViewDirection(viewPreset: ViewPreset, up: THREE.Vector3) {
  switch (viewPreset) {
    case "z+":
      return up.clone().normalize()
    case "z-":
      return up.clone().normalize().multiplyScalar(-1)
    case "y+":
      return new THREE.Vector3(0, 1, 0)
    case "y-":
      return new THREE.Vector3(0, -1, 0)
    case "x+":
      return new THREE.Vector3(1, 0, 0)
    case "x-":
      return new THREE.Vector3(-1, 0, 0)
    case "corner":
    default:
      return new THREE.Vector3(1, 1, 1).normalize()
  }
}

function getCameraUp(direction: THREE.Vector3, sceneUp: THREE.Vector3) {
  if (Math.abs(direction.dot(sceneUp)) < 0.98) {
    return sceneUp.clone().normalize()
  }

  return new THREE.Vector3(0, 1, 0)
}

function getCompassPoints(
  camera: THREE.Camera,
): Record<AxisViewPreset, CompassPoint> {
  const inverseCameraRotation = camera.quaternion.clone().invert()
  const points = {} as Record<AxisViewPreset, CompassPoint>

  for (const axis of AXIS_VIEW_BUTTONS) {
    const projected = axis.direction
      .clone()
      .applyQuaternion(inverseCameraRotation)
    points[axis.preset] = {
      x: projected.x,
      y: -projected.y,
      z: projected.z,
    }
  }

  return points
}

function areCompassPointsEqual(
  a: Record<AxisViewPreset, CompassPoint> | null,
  b: Record<AxisViewPreset, CompassPoint>,
) {
  if (!a) {
    return false
  }

  return AXIS_VIEW_BUTTONS.every((axis) => {
    const current = a[axis.preset]
    const next = b[axis.preset]
    return (
      Math.abs(current.x - next.x) < 0.001 &&
      Math.abs(current.y - next.y) < 0.001 &&
      Math.abs(current.z - next.z) < 0.001
    )
  })
}

function getSceneFrame(bounds: THREE.Box3) {
  if (bounds.isEmpty()) {
    return {
      center: new THREE.Vector3(0, 0, 0),
      radius: 24,
    }
  }

  const sphere = bounds.getBoundingSphere(new THREE.Sphere())
  return {
    center: sphere.center,
    radius: Math.max(sphere.radius, 1),
  }
}

function getViewportAspect(canvas: HTMLCanvasElement) {
  return Math.max(canvas.clientWidth, 1) / Math.max(canvas.clientHeight, 1)
}

function getOrthographicFrustumHeight(radius: number, aspect: number) {
  const fitPadding = 1.28
  return (radius * 2 * fitPadding) / Math.min(aspect, 1)
}

function configureCameraForView({
  camera,
  canvas,
  controls,
  sceneBounds,
  up,
  viewPreset,
}: {
  camera: THREE.Camera
  canvas: HTMLCanvasElement
  controls: ReturnType<typeof createControls>
  sceneBounds: THREE.Box3
  up: THREE.Vector3
  viewPreset: ViewPreset
}) {
  const direction = getViewDirection(viewPreset, up)
  const frame = getSceneFrame(sceneBounds)
  const distance = Math.max(frame.radius * 3.2, 12)
  const near = Math.max(frame.radius / 500, 0.01)
  const far = Math.max(distance + frame.radius * 100, 1000)
  const position = frame.center
    .clone()
    .add(direction.clone().multiplyScalar(distance))

  controls.target.copy(frame.center)
  controls.maxDistance = far * 0.45
  camera.up.copy(getCameraUp(direction, up))
  camera.position.copy(position)

  if (camera instanceof THREE.PerspectiveCamera) {
    camera.near = near
    camera.far = far
    camera.zoom = 1
    camera.aspect = getViewportAspect(canvas)
    const fovRadians = THREE.MathUtils.degToRad(camera.fov)
    const fitDistance = frame.radius / Math.sin(fovRadians / 2)
    camera.position.copy(
      frame.center
        .clone()
        .add(
          getViewDirection(viewPreset, up).multiplyScalar(fitDistance * 1.12),
        ),
    )
  }

  if (camera instanceof THREE.OrthographicCamera) {
    camera.near = near
    camera.far = far
    camera.zoom = 1
    const aspect = getViewportAspect(canvas)
    const frustumHeight = getOrthographicFrustumHeight(frame.radius, aspect)
    camera.top = frustumHeight / 2
    camera.bottom = -frustumHeight / 2
    camera.left = (-frustumHeight * aspect) / 2
    camera.right = (frustumHeight * aspect) / 2
  }

  camera.lookAt(frame.center)
  if (
    camera instanceof THREE.PerspectiveCamera ||
    camera instanceof THREE.OrthographicCamera
  ) {
    camera.updateProjectionMatrix()
  }
  controls.update()
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

    const createActiveCamera = () => {
      const direction = getViewDirection(viewPreset, up)
      const cameraUp = getCameraUp(direction, up)

      if (projection === "orthographic") {
        const aspect = getViewportAspect(canvas)
        const frustum = 40
        const camera = new THREE.OrthographicCamera(
          (-frustum * aspect) / 2,
          (frustum * aspect) / 2,
          frustum / 2,
          -frustum / 2,
          0.1,
          1000,
        )
        camera.up.copy(cameraUp)
        return camera
      }

      const camera = createCamera(cameraUp)
      return camera
    }

    const camera = createActiveCamera()
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
        <div className="viewport-actions">
          <button
            type="button"
            className={viewPreset === "x+" ? "is-active" : undefined}
            onClick={() => setViewPreset("x+")}
          >
            Side
          </button>
          <button
            type="button"
            className={viewPreset === "y+" ? "is-active" : undefined}
            onClick={() => setViewPreset("y+")}
          >
            Front
          </button>
          <button
            type="button"
            className={viewPreset === "z+" ? "is-active" : undefined}
            onClick={() => setViewPreset("z+")}
          >
            Top
          </button>
          <button
            type="button"
            className={viewPreset === "corner" ? "is-active" : undefined}
            onClick={() => setViewPreset("corner")}
          >
            Corner
          </button>
          <button
            type="button"
            className="projection-toggle"
            onClick={() => setFitRequest((current) => current + 1)}
          >
            Fit
          </button>
          <button
            type="button"
            className="projection-toggle"
            onClick={() =>
              setProjection((current) =>
                current === "perspective" ? "orthographic" : "perspective",
              )
            }
          >
            {projection === "perspective" ? "Orthographic" : "Perspective"}
          </button>
        </div>
      </header>
      <div className="viewport-body">
        <canvas ref={canvasRef} />
        <div className="axis-compass" aria-label="Axis camera compass">
          {[...AXIS_VIEW_BUTTONS]
            .sort((a, b) => {
              const aPoint = compassPoints?.[a.preset]
              const bPoint = compassPoints?.[b.preset]
              return (aPoint?.z ?? 0) - (bPoint?.z ?? 0)
            })
            .map((axis) => {
              const point = compassPoints?.[axis.preset] ?? {
                x: axis.direction.x,
                y: -axis.direction.y,
                z: axis.direction.z,
              }
              const radius = 28
              const depth = (point.z + 1) / 2

              return (
                <button
                  key={axis.preset}
                  type="button"
                  className={`${axis.className} ${
                    viewPreset === axis.preset ? "is-active" : ""
                  }`}
                  style={{
                    left: `${34 + point.x * radius}px`,
                    top: `${34 + point.y * radius}px`,
                    opacity: 0.46 + depth * 0.54,
                    transform: `scale(${0.72 + depth * 0.24})`,
                    zIndex: Math.round(depth * 10),
                  }}
                  title={`View ${axis.label}`}
                  aria-label={`View ${axis.label}`}
                  onClick={() => setViewPreset(axis.preset)}
                >
                  {axis.label}
                </button>
              )
            })}
          <button
            type="button"
            className={`axis-center ${viewPreset === "corner" ? "is-active" : ""}`}
            title="Corner view"
            aria-label="Corner view"
            onClick={() => setViewPreset("corner")}
          />
        </div>
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
