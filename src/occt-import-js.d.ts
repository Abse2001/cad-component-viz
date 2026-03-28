declare module "occt-import-js" {
	const occtimportjs: (options?: {
		locateFile?: (path: string, prefix: string) => string;
	}) => Promise<{
		ReadStepFile: (
			content: Uint8Array,
			params: object | null,
		) => {
			success: boolean;
			meshes: unknown[];
		};
	}>;

	export default occtimportjs;
}
