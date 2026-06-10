/**
 * The FileSystem port: the only I/O boundary of cms-core.
 *
 * All paths are interpreted relative to the implementation's configured root.
 * Implementations must resolve them under the root and reject any path that
 * escapes it (path traversal). The same brain therefore runs unchanged over
 * `node:fs` (sidecar + local dev) and, in principle, over a remote adapter.
 */
export interface CmsFileSystem {
	/** Read a UTF-8 text file. Rejects when the file does not exist. */
	readFile(path: string): Promise<string>
	/** Read a file's raw bytes (for binary assets like images). Rejects when the file does not exist. */
	readBytes(path: string): Promise<Uint8Array>
	/** Write a UTF-8 text file atomically (write temp + rename). Creates parent dirs. */
	writeFile(path: string, content: string): Promise<void>
	/** Rename/move a file. Creates the destination's parent dir. */
	rename(from: string, to: string): Promise<void>
	/** Remove a file. No-op when it does not exist. */
	remove(path: string): Promise<void>
	/** Whether a file or directory exists. */
	exists(path: string): Promise<boolean>
	/** List the immediate children of a directory. Returns [] when it does not exist. */
	list(dir: string): Promise<{ name: string; isDirectory: boolean }[]>
	/** Resolve a glob pattern (supports `*`, `**`, `?`, `{a,b}`) to matching file paths, root-relative. */
	glob(pattern: string): Promise<string[]>
	/** File metadata. Rejects when the path does not exist. */
	stat(path: string): Promise<{ mtimeMs: number; size: number }>
}
