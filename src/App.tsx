import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  ALIGNMENT_OPTIONS,
  NORMAL_OPTIONS,
  buildFallbackGeometry,
  computePlacement,
  directionToVector,
  getGeometryBounds,
  normalizeCadComponent,
  parseOBJ,
} from "./lib/cad";
import {
  addDefaultLights,
  createCamera,
  createControls,
  createRenderer,
  fitRenderer,
  makeAxisBadges,
  makeAxesToBadgePositions,
  makeBoard,
  makeBoardNormalArrow,
  makeGrid,
  makeHoverMarker,
  type HoverTarget,
} from "./lib/scene";
import { SAMPLE_CAD_COMPONENT } from "./sampleCadComponent";
import type { Alignment, AxisDirection, CadComponentInput } from "./types";

function parseInput(text: string): {
  value: CadComponentInput | null;
  error: string | null;
} {
  try {
    return { value: JSON.parse(text) as CadComponentInput, error: null };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [delayMs, value]);

  return debouncedValue;
}

function useCadGeometry(modelUrl: string) {
  const [state, setState] = useState<{
    geometry: THREE.BufferGeometry | null;
    status: "idle" | "loading" | "ready" | "fallback";
    message: string;
  }>({
    geometry: null,
    status: modelUrl ? "loading" : "fallback",
    message: modelUrl
      ? "Loading OBJ model..."
      : "Using fallback box from size.",
  });

  useEffect(() => {
    let disposed = false;

    if (!modelUrl) {
      setState({
        geometry: null,
        status: "fallback",
        message: "Using fallback box from size.",
      });
      return;
    }

    setState({
      geometry: null,
      status: "loading",
      message: "Loading OBJ model...",
    });

    const controller = new AbortController();
    fetch(modelUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch OBJ (${response.status})`);
        }
        return parseOBJ(await response.text());
      })
      .then((geometry) => {
        if (disposed) {
          geometry.dispose();
          return;
        }
        setState({
          geometry,
          status: "ready",
          message: "OBJ loaded successfully.",
        });
      })
      .catch((error: unknown) => {
        if (disposed || controller.signal.aborted) {
          return;
        }
        setState({
          geometry: null,
          status: "fallback",
          message:
            error instanceof Error
              ? `${error.message}. Falling back to size box.`
              : "Failed to load OBJ. Falling back to size box.",
        });
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [modelUrl]);

  useEffect(
    () => () => {
      state.geometry?.dispose();
    },
    [state.geometry],
  );

  return state;
}

function SceneCanvas({
  title,
  subtitle,
  up,
  buildScene,
}: {
  title: string;
  subtitle: string;
  up: THREE.Vector3;
  buildScene: (
    scene: THREE.Scene,
  ) => { hoverTargets?: HoverTarget[]; overlayObjects?: THREE.Object3D[] } | void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const controlsRef = useRef<ReturnType<typeof createControls> | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const overlaySceneRef = useRef<THREE.Scene | null>(null);
  const hoverTargetsRef = useRef<HoverTarget[]>([]);
  const [projection, setProjection] = useState<"perspective" | "orthographic">(
    "orthographic",
  );
  const [viewPreset, setViewPreset] = useState<
    "side" | "front" | "top" | "corner"
  >("corner");
  const [hovered, setHovered] = useState<{
    x: number;
    y: number;
    lines: string[];
  } | null>(null);

  const disposeScene = (scene: THREE.Scene | null) => {
    if (!scene) {
      return;
    }
    scene.traverse((object: THREE.Object3D) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) {
          for (const material of object.material) {
            material.dispose();
          }
        } else {
          object.material.dispose();
        }
      }
    });
    scene.clear();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const renderer = createRenderer(canvas);
    renderer.autoClear = false;
    const createActiveCamera = () => {
      const direction = (() => {
        switch (viewPreset) {
          case "top":
            return up.clone().normalize();
          case "front":
            return new THREE.Vector3(0, 1, 0);
          case "side":
            return new THREE.Vector3(1, 0, 0);
          case "corner":
          default:
            return new THREE.Vector3(1, 1, 1).normalize();
        }
      })();
      const distance = 90;

      if (projection === "orthographic") {
        const aspect = Math.max(canvas.clientWidth / Math.max(canvas.clientHeight, 1), 1);
        const frustum = 40;
        const camera = new THREE.OrthographicCamera(
          -frustum * aspect,
          frustum * aspect,
          frustum,
          -frustum,
          0.1,
          1000,
        );
        camera.up.copy(up);
        camera.position.copy(direction.multiplyScalar(distance));
        return camera;
      }

      const camera = createCamera(up);
      camera.position.copy(direction.multiplyScalar(distance));
      return camera;
    };

    const camera = createActiveCamera();
    const controls = createControls(camera, canvas);
    const scene = new THREE.Scene();
    const overlayScene = new THREE.Scene();
    rendererRef.current = renderer;
    cameraRef.current = camera;
    controlsRef.current = controls;
    sceneRef.current = scene;
    overlaySceneRef.current = overlayScene;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const resize = () => fitRenderer(renderer, camera, canvas);
    resize();

    const updateHover = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const intersections = raycaster.intersectObjects(
        hoverTargetsRef.current.map((target) => target.object),
        true,
      );

      if (intersections.length === 0) {
        setHovered(null);
        canvas.style.cursor = "default";
        return;
      }

      const hit = hoverTargetsRef.current.find((target) =>
        intersections.some(
          (intersection) =>
            intersection.object === target.object ||
            target.object.children.includes(intersection.object),
        ),
      );

      if (!hit) {
        setHovered(null);
        canvas.style.cursor = "default";
        return;
      }

      const projected = hit.position.clone().project(camera);
      setHovered({
        x: ((projected.x + 1) / 2) * rect.width,
        y: ((-projected.y + 1) / 2) * rect.height - 12,
        lines: hit.lines,
      });
      canvas.style.cursor = "pointer";
    };

    const onPointerMove = (event: PointerEvent) => {
      updateHover(event.clientX, event.clientY);
    };

    const onPointerLeave = () => {
      setHovered(null);
      canvas.style.cursor = "default";
    };

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);

    let animationFrame = 0;
    const render = () => {
      animationFrame = window.requestAnimationFrame(render);
      controls.update();
      renderer.clear();
      renderer.render(scene, camera);
      renderer.clearDepth();
      renderer.render(overlayScene, camera);
    };
    render();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      controls.dispose();
      renderer.dispose();
      disposeScene(scene);
      disposeScene(overlayScene);
      hoverTargetsRef.current = [];
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      sceneRef.current = null;
      overlaySceneRef.current = null;
    };
  }, [projection, up, viewPreset]);

  useEffect(() => {
    const scene = sceneRef.current;
    const overlayScene = overlaySceneRef.current;
    if (!scene || !overlayScene) {
      return;
    }
    disposeScene(scene);
    disposeScene(overlayScene);
    const buildResult = buildScene(scene);
    hoverTargetsRef.current = buildResult?.hoverTargets ?? [];
    for (const object of buildResult?.overlayObjects ?? []) {
      overlayScene.add(object);
    }
  }, [buildScene, projection, up, viewPreset]);

  return (
    <section className="viewport">
      <header className="viewport-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="viewport-actions">
          <button type="button" onClick={() => setViewPreset("side")}>
            Side
          </button>
          <button type="button" onClick={() => setViewPreset("front")}>
            Front
          </button>
          <button type="button" onClick={() => setViewPreset("top")}>
            Top
          </button>
          <button type="button" onClick={() => setViewPreset("corner")}>
            Corner
          </button>
          <button
            type="button"
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
  );
}

function NumberField({
  label,
  value,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="control-row">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Vector3Field({
  title,
  labels,
  values,
  step = 0.1,
  onChange,
}: {
  title: string;
  labels: [string, string, string];
  values: [number, number, number];
  step?: number;
  onChange: (axis: "x" | "y" | "z", value: number) => void;
}) {
  const axes: Array<"x" | "y" | "z"> = ["x", "y", "z"];
  return (
    <div className="vector3-block">
      <div className="vector3-title">{title}</div>
      <div className="vector3-field">
      {labels.map((label) => (
        <span key={label} className="vector3-label">
          {label}
        </span>
      ))}
      {values.map((value, index) => (
        <input
          key={axes[index] ?? index}
          type="number"
          value={value}
          step={step}
          onChange={(event) =>
            onChange(axes[index] ?? "x", Number(event.target.value))
          }
        />
      ))}
      </div>
    </div>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="control-row">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="editor-card">
      <div className="editor-card-header">
        <h2>{title}</h2>
      </div>
      <div className="editor-grid">{children}</div>
    </section>
  );
}

function App() {
  const [cad, setCad] = useState(() => normalizeCadComponent(SAMPLE_CAD_COMPONENT));
  const [boardThickness, setBoardThickness] = useState(1.6);
  const [importText, setImportText] = useState(() =>
    JSON.stringify(SAMPLE_CAD_COMPONENT, null, 2),
  );
  const [importError, setImportError] = useState<string | null>(null);

  const debouncedCad = useDebouncedValue(cad, 350);
  const debouncedBoardThickness = useDebouncedValue(boardThickness, 350);
  const fallbackGeometry = useMemo(
    () => buildFallbackGeometry(debouncedCad),
    [debouncedCad],
  );
  const { geometry: fetchedGeometry, status, message } = useCadGeometry(
    debouncedCad.model_obj_url,
  );
  const geometry = fetchedGeometry ?? fallbackGeometry;
  const placement = useMemo(() => computePlacement(debouncedCad), [debouncedCad]);
  const geometryBounds = useMemo(() => getGeometryBounds(geometry), [geometry]);
  const modelUp = useMemo(
    () => directionToVector(debouncedCad.model_board_normal_direction),
    [debouncedCad.model_board_normal_direction],
  );
  const generatedJson = useMemo(() => JSON.stringify(cad, null, 2), [cad]);
  const formatVec3 = (vector: THREE.Vector3) =>
    `(${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}, ${vector.z.toFixed(2)})`;

  const update = <K extends keyof typeof cad>(key: K, value: (typeof cad)[K]) => {
    setCad((current) => ({ ...current, [key]: value }));
  };

  const updateVec3 = (
    key: "model_origin_position" | "position",
    axis: "x" | "y" | "z",
    value: number,
  ) => {
    setCad((current) => ({
      ...current,
      [key]: {
        ...current[key],
        [axis]: value,
      },
    }));
  };

  const updateSize = (
    axis: "x" | "y" | "z",
    value: number,
  ) => {
    setCad((current) => ({
      ...current,
      size: {
        ...current.size,
        [axis]: value,
      },
    }));
  };

  const importJson = () => {
    const parsed = parseInput(importText);
    if (!parsed.value) {
      setImportError(parsed.error ?? "Invalid JSON");
      return;
    }
    setCad(normalizeCadComponent(parsed.value));
    setImportError(null);
  };

  const modelScene = useMemo(
    () => (scene: THREE.Scene) => {
      addDefaultLights(scene);
      scene.add(makeGrid(90, 36, debouncedCad.model_board_normal_direction));
      scene.add(makeAxesToBadgePositions(geometryBounds.boundingBox));
      scene.add(
        new THREE.Mesh(
          geometry.clone(),
          new THREE.MeshPhongMaterial({
            color: 0x79a8ff,
            transparent: true,
            opacity: 0.84,
            side: THREE.DoubleSide,
          }),
        ),
      );
      scene.add(makeAxisBadges(geometryBounds.boundingBox));
      const modelOriginMarker = makeHoverMarker(placement.modelOrigin, [
        `Model Origin ${formatVec3(placement.modelOrigin)}`,
        `Model Origin Alignment: ${debouncedCad.model_origin_alignment}`,
      ]);
      scene.add(
        makeBoardNormalArrow(
          placement.modelOrigin,
          debouncedCad.model_board_normal_direction,
        ),
      );
      return {
        hoverTargets: [modelOriginMarker.target],
        overlayObjects: [modelOriginMarker.group],
      };
    },
    [
      debouncedCad.model_board_normal_direction,
      debouncedCad.model_origin_alignment,
      geometry,
      geometryBounds.boundingBox,
      placement.modelOrigin,
    ],
  );

  const boardScene = useMemo(
    () => (scene: THREE.Scene) => {
      addDefaultLights(scene);
      scene.add(makeGrid(90, 36, "z+"));
      scene.add(makeBoard(debouncedBoardThickness));

      const placed = new THREE.Group();
      placed.rotation.copy(placement.rotation);
      placed.position.copy(placement.translation);
      placed.add(
        new THREE.Mesh(
          geometry.clone(),
          new THREE.MeshPhongMaterial({
            color: 0x7dd3a7,
            transparent: true,
            opacity: 0.84,
            side: THREE.DoubleSide,
          }),
        ),
      );
      scene.add(placed);
      placed.updateMatrixWorld(true);
      const boardPosition = new THREE.Vector3(
        debouncedCad.position.x,
        debouncedCad.position.y,
        debouncedCad.position.z,
      );
      const boardPositionMarker = makeHoverMarker(boardPosition, [
        `Cad Component Position ${formatVec3(boardPosition)}`,
        `Anchor Alignment: ${debouncedCad.anchor_alignment}`,
      ]);

      const placedBounds = geometryBounds.boundingBox
        .clone()
        .applyMatrix4(placed.matrixWorld);
      scene.add(makeAxesToBadgePositions(placedBounds));
      scene.add(makeAxisBadges(placedBounds));
      return {
        hoverTargets: [boardPositionMarker.target],
        overlayObjects: [boardPositionMarker.group],
      };
    },
    [
      debouncedCad.anchor_alignment,
      debouncedBoardThickness,
      debouncedCad.position.x,
      debouncedCad.position.y,
      debouncedCad.position.z,
      geometry,
      geometryBounds.boundingBox,
      placement.rotation,
      placement.translation,
    ],
  );

  const statusClass =
    status === "ready" ? "ok" : status === "loading" ? "loading" : "warning";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="hero">
          <p className="eyebrow">Circuit JSON</p>
          <h1>`cad_component` visualizer</h1>
          <p className="lede">
            Edit the placement fields directly, then inspect how the model-space
            board normal maps into board-space z+.
          </p>
        </div>

        <div className={`status-pill ${statusClass}`}>{message}</div>

        <Section title="component model">
          <Vector3Field
            title="model_origin_position"
            labels={["x", "y", "z"]}
            values={[
              cad.model_origin_position.x,
              cad.model_origin_position.y,
              cad.model_origin_position.z,
            ]}
            onChange={(axis, value) => updateVec3("model_origin_position", axis, value)}
          />
          <SelectField<Alignment>
            label="model_origin_alignment"
            value={cad.model_origin_alignment}
            options={ALIGNMENT_OPTIONS}
            onChange={(value) => update("model_origin_alignment", value)}
          />
          <SelectField<AxisDirection>
            label="model_board_normal_direction"
            value={cad.model_board_normal_direction}
            options={NORMAL_OPTIONS}
            onChange={(value) => update("model_board_normal_direction", value)}
          />
        </Section>

        <Section title="component">
          <Vector3Field
            title="position"
            labels={["x", "y", "z"]}
            values={[cad.position.x, cad.position.y, cad.position.z]}
            onChange={(axis, value) => updateVec3("position", axis, value)}
          />
          <Vector3Field
            title="size"
            labels={["x", "y", "z"]}
            values={[cad.size.x, cad.size.y, cad.size.z]}
            onChange={(axis, value) => updateSize(axis, value)}
          />
          <SelectField<Alignment>
            label="anchor_alignment"
            value={cad.anchor_alignment}
            options={ALIGNMENT_OPTIONS}
            onChange={(value) => update("anchor_alignment", value)}
          />
        </Section>

        <Section title="model_obj_url">
          <label className="control-stack">
            <span>model_obj_url</span>
            <input
              type="text"
              value={cad.model_obj_url}
              onChange={(event) => update("model_obj_url", event.target.value)}
            />
          </label>
        </Section>

        <details className="json-panel">
          <summary>board properties</summary>
          <div className="editor-grid details-grid">
            <NumberField
              label="board_thickness"
              value={boardThickness}
              onChange={setBoardThickness}
            />
          </div>
        </details>

        <details className="json-panel">
          <summary>Circuit JSON</summary>
          <p className="json-help">
            Import by pasting JSON and clicking apply. The form controls stay
            authoritative for editing.
          </p>
          <label className="field">
            <span>Paste JSON</span>
            <textarea
              className="import-textarea"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              spellCheck={false}
            />
          </label>
          <div className="actions">
            <button type="button" onClick={importJson}>
              Apply pasted JSON
            </button>
          </div>
          {importError ? (
            <div className="status-pill error">JSON parse error: {importError}</div>
          ) : null}
          <label className="field">
            <span>Generated `cad_component`</span>
            <textarea
              className="json-output"
              value={generatedJson}
              readOnly
              spellCheck={false}
            />
          </label>
        </details>
      </aside>

      <section className="viewports">
        <SceneCanvas
          title="Model space"
          subtitle={`${debouncedCad.model_board_normal_direction} is treated as board-up in the raw model.`}
          up={modelUp}
          buildScene={modelScene}
        />
        <SceneCanvas
          title="Board space"
          subtitle="The component is rotated into z+ and translated onto the board."
          up={new THREE.Vector3(0, 0, 1)}
          buildScene={boardScene}
        />
      </section>
    </main>
  );
}

export default App;
