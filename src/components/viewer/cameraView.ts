import * as THREE from "three"
import { createCamera, type createControls } from "../../lib/scene"
import type { ProjectionMode, ViewPreset } from "./viewerTypes"

export function getViewDirection(viewPreset: ViewPreset, up: THREE.Vector3) {
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

export function getCameraUp(direction: THREE.Vector3, sceneUp: THREE.Vector3) {
  if (Math.abs(direction.dot(sceneUp)) < 0.98) {
    return sceneUp.clone().normalize()
  }

  return new THREE.Vector3(0, 1, 0)
}

export function getViewportAspect(canvas: HTMLCanvasElement) {
  return Math.max(canvas.clientWidth, 1) / Math.max(canvas.clientHeight, 1)
}

export function createViewportCamera({
  canvas,
  projection,
  up,
  viewPreset,
}: {
  canvas: HTMLCanvasElement
  projection: ProjectionMode
  up: THREE.Vector3
  viewPreset: ViewPreset
}) {
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

  return createCamera(cameraUp)
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

function getOrthographicFrustumHeight(radius: number, aspect: number) {
  const fitPadding = 1.28
  return (radius * 2 * fitPadding) / Math.min(aspect, 1)
}

export function configureCameraForView({
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
