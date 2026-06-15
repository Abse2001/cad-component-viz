import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { DIR_VEC } from "./cad"
import type { AxisDirection } from "../types"

export interface HoverTarget {
  object: THREE.Object3D
  position: THREE.Vector3
  lines: string[]
}

interface AxisBadgeSpec {
  text: string
  fill: string
  position: THREE.Vector3
}

type AxisTransform = THREE.Euler | THREE.Quaternion | THREE.Matrix4

export function createRenderer(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    canvas,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor("#ffffff")
  return renderer
}

export function createCamera(up: THREE.Vector3) {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
  camera.up.copy(up)
  camera.position.set(52, 42, 38)
  return camera
}

export function createControls(
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
) {
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.target.set(0, 0, 0)
  return controls
}

export function fitRenderer(
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
) {
  const { clientWidth, clientHeight } = canvas
  if (clientWidth === 0 || clientHeight === 0) {
    return
  }
  renderer.setSize(clientWidth, clientHeight, false)
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = clientWidth / clientHeight
    camera.updateProjectionMatrix()
    return
  }
  if (camera instanceof THREE.OrthographicCamera) {
    const aspect = clientWidth / clientHeight
    const frustumHeight = camera.top - camera.bottom
    camera.left = (-frustumHeight * aspect) / 2
    camera.right = (frustumHeight * aspect) / 2
    camera.updateProjectionMatrix()
  }
}

export function makeGrid(
  size: number,
  divisions: number,
  normal: AxisDirection,
) {
  const grid = new THREE.GridHelper(size, divisions, 0xb8c2cc, 0xe5e7eb)
  if (normal === "z+" || normal === "z-") {
    grid.rotation.x = Math.PI / 2
  } else if (normal === "x+" || normal === "x-") {
    grid.rotation.z = Math.PI / 2
  }
  return grid
}

export function makeAxes(length = 20) {
  const group = new THREE.Group()
  const axes = [
    { name: "X", direction: new THREE.Vector3(1, 0, 0), color: 0xff5d73 },
    { name: "Y", direction: new THREE.Vector3(0, 1, 0), color: 0x5dff97 },
    { name: "Z", direction: new THREE.Vector3(0, 0, 1), color: 0x5da9ff },
  ]

  for (const axis of axes) {
    const shaftLength = length * 1.35
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, shaftLength, 18),
      new THREE.MeshBasicMaterial({ color: axis.color }),
    )
    shaft.position.copy(axis.direction.clone().multiplyScalar(shaftLength / 2))
    shaft.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      axis.direction,
    )
    group.add(shaft)
  }

  return group
}

function makeAxisShaft(
  direction: THREE.Vector3,
  color: number,
  end: THREE.Vector3,
) {
  const length = end.length()
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, length, 18),
    new THREE.MeshBasicMaterial({ color }),
  )
  shaft.position.copy(direction.clone().multiplyScalar(length / 2))
  shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)
  return shaft
}

function makeBadgeTexture(text: string, fillStyle: string) {
  const canvas = document.createElement("canvas")
  canvas.width = 96
  canvas.height = 96
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    return new THREE.CanvasTexture(canvas)
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = fillStyle
  ctx.beginPath()
  ctx.arc(48, 48, 34, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = "#ffffff"
  ctx.font = "600 25px sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, 48, 49)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function makeDimensionTexture(text: string, color: string) {
  const canvas = document.createElement("canvas")
  canvas.width = 256
  canvas.height = 80
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    return new THREE.CanvasTexture(canvas)
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = "rgba(255, 255, 255, 0.94)"
  ctx.strokeStyle = "rgba(196, 208, 224, 0.95)"
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(8, 10, 240, 56, 14)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = color
  ctx.font = "700 24px sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, 128, 39)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function makeDimensionLabel(
  text: string,
  color: string,
  position: THREE.Vector3,
) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeDimensionTexture(text, color),
      depthTest: false,
      depthWrite: false,
    }),
  )
  sprite.position.copy(position)
  sprite.scale.set(11, 3.4, 1)
  return sprite
}

function makeLine(points: THREE.Vector3[], color: number) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  return new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    }),
  )
}

function formatDimension(value: number) {
  return `${value.toFixed(2)} mm`
}

export function makeDimensionOverlay(bounds: THREE.Box3) {
  const group = new THREE.Group()
  const size = bounds.getSize(new THREE.Vector3())
  const maxDimension = Math.max(size.x, size.y, size.z, 1)
  const margin = maxDimension * 0.08 + 1.8
  const tick = Math.min(Math.max(maxDimension * 0.035, 0.8), 3)
  const xColor = 0xc93345
  const yColor = 0x16834d
  const zColor = 0x2568d8

  group.add(new THREE.Box3Helper(bounds, 0x40506a))

  const xStart = new THREE.Vector3(
    bounds.min.x,
    bounds.min.y - margin,
    bounds.min.z - margin,
  )
  const xEnd = new THREE.Vector3(
    bounds.max.x,
    bounds.min.y - margin,
    bounds.min.z - margin,
  )
  const yStart = new THREE.Vector3(
    bounds.min.x - margin,
    bounds.min.y,
    bounds.min.z - margin,
  )
  const yEnd = new THREE.Vector3(
    bounds.min.x - margin,
    bounds.max.y,
    bounds.min.z - margin,
  )
  const zStart = new THREE.Vector3(
    bounds.max.x + margin,
    bounds.min.y - margin,
    bounds.min.z,
  )
  const zEnd = new THREE.Vector3(
    bounds.max.x + margin,
    bounds.min.y - margin,
    bounds.max.z,
  )

  group.add(makeLine([xStart, xEnd], xColor))
  group.add(makeLine([yStart, yEnd], yColor))
  group.add(makeLine([zStart, zEnd], zColor))

  for (const point of [xStart, xEnd]) {
    group.add(
      makeLine(
        [
          point.clone().add(new THREE.Vector3(0, -tick, 0)),
          point.clone().add(new THREE.Vector3(0, tick, 0)),
        ],
        xColor,
      ),
    )
  }
  for (const point of [yStart, yEnd]) {
    group.add(
      makeLine(
        [
          point.clone().add(new THREE.Vector3(-tick, 0, 0)),
          point.clone().add(new THREE.Vector3(tick, 0, 0)),
        ],
        yColor,
      ),
    )
  }
  for (const point of [zStart, zEnd]) {
    group.add(
      makeLine(
        [
          point.clone().add(new THREE.Vector3(tick, 0, 0)),
          point.clone().add(new THREE.Vector3(-tick, 0, 0)),
        ],
        zColor,
      ),
    )
  }

  group.add(
    makeDimensionLabel(
      `X ${formatDimension(size.x)}`,
      "#c93345",
      xStart
        .clone()
        .lerp(xEnd, 0.5)
        .add(new THREE.Vector3(0, -tick * 1.7, 0)),
    ),
  )
  group.add(
    makeDimensionLabel(
      `Y ${formatDimension(size.y)}`,
      "#16834d",
      yStart
        .clone()
        .lerp(yEnd, 0.5)
        .add(new THREE.Vector3(-tick * 1.7, 0, 0)),
    ),
  )
  group.add(
    makeDimensionLabel(
      `Z ${formatDimension(size.z)}`,
      "#2568d8",
      zStart
        .clone()
        .lerp(zEnd, 0.5)
        .add(new THREE.Vector3(tick * 1.7, 0, 0)),
    ),
  )

  return group
}

function applyAxisTransform(
  direction: THREE.Vector3,
  transform?: AxisTransform,
) {
  if (!transform) {
    return direction
  }
  if (transform instanceof THREE.Euler) {
    return direction.applyEuler(transform)
  }
  if (transform instanceof THREE.Quaternion) {
    return direction.applyQuaternion(transform)
  }
  return direction.applyMatrix4(transform).normalize()
}

export function getAxisBadgeSpecs(
  bounds: THREE.Box3,
  transform?: AxisTransform,
): AxisBadgeSpec[] {
  const size = bounds.getSize(new THREE.Vector3())
  const maxDimension = Math.max(size.x, size.y, size.z, 1)
  const offset = maxDimension * 1.1

  const axisSpecs: Array<{
    text: string
    fill: string
    direction: THREE.Vector3
  }> = [
    {
      text: "x+",
      fill: "#b91c1c",
      direction: new THREE.Vector3(1, 0, 0),
    },
    {
      text: "x-",
      fill: "#b91c1c",
      direction: new THREE.Vector3(-1, 0, 0),
    },
    {
      text: "y+",
      fill: "#15803d",
      direction: new THREE.Vector3(0, 1, 0),
    },
    {
      text: "y-",
      fill: "#15803d",
      direction: new THREE.Vector3(0, -1, 0),
    },
    {
      text: "z+",
      fill: "#1d4ed8",
      direction: new THREE.Vector3(0, 0, 1),
    },
    {
      text: "z-",
      fill: "#1d4ed8",
      direction: new THREE.Vector3(0, 0, -1),
    },
  ]

  return axisSpecs.map((spec) => ({
    text: spec.text,
    fill: spec.fill,
    position: applyAxisTransform(
      spec.direction.clone(),
      transform,
    ).multiplyScalar(offset),
  }))
}

export function makeAxesToBadgePositions(
  bounds: THREE.Box3,
  transform?: AxisTransform,
) {
  const group = new THREE.Group()
  const labels = getAxisBadgeSpecs(bounds, transform)
  const axisColors: Record<string, number> = {
    x: 0xff5d73,
    y: 0x5dff97,
    z: 0x5da9ff,
  }

  for (const label of labels) {
    const axis = label.text[0] as "x" | "y" | "z"
    const sign = label.text[1] === "+" ? 1 : -1
    const color = axisColors[axis] ?? 0x6b7280
    const direction =
      axis === "x"
        ? new THREE.Vector3(sign, 0, 0)
        : axis === "y"
          ? new THREE.Vector3(0, sign, 0)
          : new THREE.Vector3(0, 0, sign)
    group.add(makeAxisShaft(direction, color, label.position))
  }

  return group
}

export function makeAxisBadges(bounds: THREE.Box3, transform?: AxisTransform) {
  const labels = getAxisBadgeSpecs(bounds, transform)
  const group = new THREE.Group()
  for (const label of labels) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeBadgeTexture(label.text, label.fill),
        depthTest: true,
        depthWrite: false,
      }),
    )
    sprite.position.copy(label.position)
    sprite.scale.set(4.2, 4.2, 1)
    group.add(sprite)
  }
  return group
}

export function makeBoard(boardThickness: number) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(56, 56, boardThickness),
    new THREE.MeshPhongMaterial({
      color: 0x1d7b4f,
      transparent: true,
      opacity: 0.82,
    }),
  )
}

export function makeOriginMarker(position: THREE.Vector3, color: number) {
  const group = new THREE.Group()
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.48, 24, 24),
    new THREE.MeshBasicMaterial({ color }),
  )
  sphere.position.copy(position)
  group.add(sphere)

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.82, 0.08, 16, 40),
    new THREE.MeshBasicMaterial({ color }),
  )
  ring.position.copy(position)
  group.add(ring)
  return group
}

export function makeHoverMarker(
  position: THREE.Vector3,
  lines: string[],
  color = 0xff00aa,
) {
  const group = new THREE.Group()
  const marker = makeOriginMarker(position, color)
  group.add(marker)

  const hitbox = new THREE.Mesh(
    new THREE.SphereGeometry(2.8, 18, 18),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  )
  hitbox.position.copy(position)
  group.add(hitbox)

  return {
    group,
    target: {
      object: hitbox,
      position: position.clone(),
      lines,
    } satisfies HoverTarget,
  }
}

export function makeBoardNormalArrow(
  origin: THREE.Vector3,
  direction: AxisDirection,
) {
  const vector = DIR_VEC[direction]
  const directionVector = new THREE.Vector3(
    vector[0],
    vector[1],
    vector[2],
  ).normalize()
  return new THREE.ArrowHelper(directionVector, origin, 16, 0xffcf5c, 2.8, 1.2)
}

export function addDefaultLights(scene: THREE.Scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 1))

  const key = new THREE.DirectionalLight(0xffffff, 1.25)
  key.position.set(18, 24, 30)
  scene.add(key)

  const fill = new THREE.DirectionalLight(0xffffff, 0.35)
  fill.position.set(-20, -10, 18)
  scene.add(fill)
}
