import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { OcctModule } from "./occt";
import type { Alignment, AxisDirection, CadComponentInput } from "../types";

export const NORMAL_OPTIONS: AxisDirection[] = [
	"z+",
	"z-",
	"y+",
	"y-",
	"x+",
	"x-",
];
export const ALIGNMENT_OPTIONS: Alignment[] = [
	"center_of_component_board_surface",
	"center",
];

export const DIR_VEC: Record<AxisDirection, [number, number, number]> = {
	"x+": [1, 0, 0],
	"x-": [-1, 0, 0],
	"y+": [0, 1, 0],
	"y-": [0, -1, 0],
	"z+": [0, 0, 1],
	"z-": [0, 0, -1],
};

export function normalizeCadComponent(
	input: CadComponentInput,
): Required<CadComponentInput> {
	return {
		name: input.name ?? "Unnamed cad_component",
		description: input.description ?? "",
		model_obj_url: input.model_obj_url ?? "",
		size: input.size ?? { x: 16, y: 12, z: 6 },
		model_board_normal_direction: input.model_board_normal_direction ?? "z+",
		model_origin_alignment:
			input.model_origin_alignment ?? "center_of_component_board_surface",
		model_origin_position: input.model_origin_position ?? { x: 0, y: 0, z: 0 },
		anchor_alignment:
			input.anchor_alignment ?? "center_of_component_board_surface",
		position: input.position ?? { x: 0, y: 0, z: 0.8 },
	};
}

export function normalToEuler(direction: AxisDirection): THREE.Euler {
	const rotations: Record<AxisDirection, [number, number, number]> = {
		"z+": [0, 0, 0],
		"z-": [Math.PI, 0, 0],
		"y+": [Math.PI / 2, 0, 0],
		"y-": [-Math.PI / 2, 0, 0],
		"x+": [0, -Math.PI / 2, 0],
		"x-": [0, Math.PI / 2, 0],
	};
	const [x, y, z] = rotations[direction];
	return new THREE.Euler(x, y, z, "XYZ");
}

export function directionToVector(direction: AxisDirection): THREE.Vector3 {
	const [x, y, z] = DIR_VEC[direction];
	return new THREE.Vector3(x, y, z);
}

export function describeRotation(direction: AxisDirection): string {
	const descriptions: Record<AxisDirection, string> = {
		"z+": "None. The model already uses z+ as board-up.",
		"z-": "Rotate 180 degrees around X.",
		"y+": "Rotate 90 degrees around X.",
		"y-": "Rotate -90 degrees around X.",
		"x+": "Rotate -90 degrees around Y.",
		"x-": "Rotate 90 degrees around Y.",
	};
	return descriptions[direction];
}

export function buildFallbackGeometry(
	input: Required<CadComponentInput>,
): THREE.BufferGeometry {
	const geometry = new THREE.BoxGeometry(
		input.size.x,
		input.size.y,
		input.size.z,
	);
	const { x, y, z } = input.model_origin_position;
	geometry.translate(-x, -y, -z);
	return geometry;
}

export function parseOBJ(text: string): THREE.BufferGeometry {
	const vertices: Array<[number, number, number]> = [];
	const positions: number[] = [];

	for (const line of text.split("\n")) {
		const parts = line.trim().split(/\s+/);
		if (parts[0] === "v" && parts.length >= 4) {
			vertices.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
			continue;
		}

		if (parts[0] !== "f" || parts.length < 4) {
			continue;
		}

		const indices = parts
			.slice(1)
			.map((entry) => Number.parseInt(entry.split("/")[0] ?? "", 10) - 1)
			.filter((index) => Number.isFinite(index));

		for (let index = 1; index < indices.length - 1; index += 1) {
			const a = indices[0];
			const b = indices[index];
			const c = indices[index + 1];
			if (a === undefined || b === undefined || c === undefined) {
				continue;
			}
			const tri = [a, b, c];
			for (const vertexIndex of tri) {
				const vertex = vertices[vertexIndex];
				if (vertex) {
					positions.push(vertex[0], vertex[1], vertex[2]);
				}
			}
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(positions, 3),
	);
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	return geometry;
}

function hasSTEPHeader(content: ArrayBuffer): boolean {
	const text = new TextDecoder().decode(content.slice(0, 512)).toUpperCase();
	return text.includes("ISO-10303-21") || text.includes("FILE_SCHEMA");
}

export type ModelFormat = "obj" | "step" | "gltf" | "glb";

let occtModulePromise: Promise<OcctModule> | null = null;

function getModelExtension(nameOrUrl: string): string {
	const normalized = nameOrUrl.trim().toLowerCase();
	if (!normalized) {
		return "";
	}

	if (normalized.startsWith("blob:")) {
		return "";
	}

	try {
		const parsed = new URL(normalized, window.location.href);
		const pathname = parsed.pathname.toLowerCase();
		return pathname.split(".").pop() ?? "";
	} catch {
		return normalized.split("?")[0]?.split("#")[0]?.split(".").pop() ?? "";
	}
}

export function detectModelFormat(nameOrUrl: string): ModelFormat | null {
	const extension = getModelExtension(nameOrUrl);
	if (extension === "obj") {
		return "obj";
	}
	if (extension === "step" || extension === "stp") {
		return "step";
	}
	if (extension === "gltf") {
		return "gltf";
	}
	if (extension === "glb") {
		return "glb";
	}
	return null;
}

export async function parseModelFromText(
	content: string,
	format: ModelFormat,
): Promise<THREE.BufferGeometry> {
	if (format === "obj") {
		return parseOBJ(content);
	}
	throw new Error(`Text parsing is not supported for ${format.toUpperCase()} files.`);
}

export async function parseModelFromBuffer(
	content: ArrayBuffer,
	format: ModelFormat,
): Promise<THREE.BufferGeometry> {
	if (format === "obj") {
		return parseOBJ(new TextDecoder().decode(content));
	}
	if (format === "step") {
		return parseSTEP(content);
	}
	if (format === "gltf" || format === "glb") {
		return parseGLTFContent(content, format);
	}
	throw new Error("Unsupported model format.");
}

export async function parseModelFromUnknownBuffer(
	content: ArrayBuffer,
): Promise<{ geometry: THREE.BufferGeometry; format: ModelFormat }> {
	if (hasGLBHeader(content)) {
		return {
			geometry: await parseGLTFContent(content, "glb"),
			format: "glb",
		};
	}

	if (hasSTEPHeader(content)) {
		return {
			geometry: await parseSTEP(content),
			format: "step",
		};
	}

	const text = new TextDecoder().decode(content);
	if (looksLikeGLTFJson(text)) {
		return {
			geometry: await parseGLTFContent(content, "gltf"),
			format: "gltf",
		};
	}

	const geometry = parseOBJ(text);
	const positionAttribute = geometry.getAttribute("position");
	if (positionAttribute && positionAttribute.count > 0) {
		return {
			geometry,
			format: "obj",
		};
	}

	geometry.dispose();

	throw new Error("Could not detect model format. Use .obj, .step, .stp, .gltf, or .glb.");
}

export async function parseModelFromUrl(
	url: string,
	format: ModelFormat,
): Promise<THREE.BufferGeometry> {
	if (format === "gltf" || format === "glb") {
		const loader = new GLTFLoader();
		const gltf = await loader.loadAsync(url);
		return extractGeometryFromObject3D(gltf.scene);
	}

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch model (${response.status})`);
	}

	return parseModelFromBuffer(await response.arrayBuffer(), format);
}

export async function parseSTEP(content: ArrayBuffer): Promise<THREE.BufferGeometry> {
	const module = await loadOcctModule();
	const result = module.ReadStepFile(new Uint8Array(content), {
		linearUnit: "millimeter",
		linearDeflectionType: "bounding_box_ratio",
		linearDeflection: 0.001,
		angularDeflection: 0.5,
	});

	if (!result.success || result.meshes.length === 0) {
		throw new Error("STEP import failed.");
	}

	const geometries = result.meshes.map((mesh) => {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3),
		);
		geometry.setIndex(mesh.index.array);
		if (mesh.attributes.normal) {
			geometry.setAttribute(
				"normal",
				new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3),
			);
		} else {
			geometry.computeVertexNormals();
		}
		return geometry;
	});

	const mergedGeometry = mergeGeometries(geometries, false);
	for (const geometry of geometries) {
		if (geometry !== mergedGeometry) {
			geometry.dispose();
		}
	}

	if (!mergedGeometry) {
		throw new Error("STEP import returned incompatible mesh data.");
	}

	mergedGeometry.computeBoundingBox();
	return mergedGeometry;
}

async function loadOcctModule(): Promise<OcctModule> {
	if (!occtModulePromise) {
		occtModulePromise = import("./occt").then(({ getOcctModule }) => getOcctModule());
	}
	return occtModulePromise;
}

function hasGLBHeader(content: ArrayBuffer): boolean {
	if (content.byteLength < 4) {
		return false;
	}
	const header = new Uint8Array(content, 0, 4);
	return (
		header[0] === 0x67 &&
		header[1] === 0x6c &&
		header[2] === 0x54 &&
		header[3] === 0x46
	);
}

function looksLikeGLTFJson(content: string): boolean {
	try {
		const parsed = JSON.parse(content) as {
			asset?: { version?: unknown };
			scenes?: unknown;
			nodes?: unknown;
			meshes?: unknown;
		};
		return (
			typeof parsed.asset?.version === "string" &&
			(Array.isArray(parsed.scenes) ||
				Array.isArray(parsed.nodes) ||
				Array.isArray(parsed.meshes))
		);
	} catch {
		return false;
	}
}

async function parseGLTFContent(
	content: ArrayBuffer,
	format: Extract<ModelFormat, "gltf" | "glb">,
): Promise<THREE.BufferGeometry> {
	const loader = new GLTFLoader();
	const data = format === "gltf" ? new TextDecoder().decode(content) : content;
	const gltf = await loader.parseAsync(data, "");
	return extractGeometryFromObject3D(gltf.scene);
}

function extractGeometryFromObject3D(object: THREE.Object3D): THREE.BufferGeometry {
	object.updateMatrixWorld(true);

	const geometries: THREE.BufferGeometry[] = [];
	object.traverse((child) => {
		if (!(child instanceof THREE.Mesh) || !child.geometry) {
			return;
		}

		const geometry = child.geometry.clone();
		geometry.applyMatrix4(child.matrixWorld);
		if (!geometry.getAttribute("normal")) {
			geometry.computeVertexNormals();
		}
		geometries.push(geometry);
	});

	if (geometries.length === 0) {
		throw new Error("glTF import did not contain any mesh geometry.");
	}

	const mergedGeometry =
		geometries.length === 1
			? geometries[0]
			: mergeGeometries(geometries, false);

	for (const geometry of geometries) {
		if (geometry !== mergedGeometry) {
			geometry.dispose();
		}
	}

	if (!mergedGeometry) {
		throw new Error("glTF import returned incompatible mesh data.");
	}

	mergedGeometry.computeBoundingBox();
	return mergedGeometry;
}

export function computePlacement(input: Required<CadComponentInput>) {
	const rotation = normalToEuler(input.model_board_normal_direction);
	const modelOrigin = new THREE.Vector3(
		input.model_origin_position.x,
		input.model_origin_position.y,
		input.model_origin_position.z,
	);
	const rotatedOrigin = modelOrigin.clone().applyEuler(rotation);
	const translation = new THREE.Vector3(
		input.position.x - rotatedOrigin.x,
		input.position.y - rotatedOrigin.y,
		input.position.z - rotatedOrigin.z,
	);

	return {
		modelOrigin,
		rotatedOrigin,
		rotation,
		translation,
	};
}

export function getGeometryBounds(geometry: THREE.BufferGeometry) {
	if (!geometry.boundingBox) {
		geometry.computeBoundingBox();
	}
	const boundingBox = geometry.boundingBox?.clone() ?? new THREE.Box3();
	const size = boundingBox.getSize(new THREE.Vector3());
	const center = boundingBox.getCenter(new THREE.Vector3());
	return {
		boundingBox,
		size,
		center,
	};
}
