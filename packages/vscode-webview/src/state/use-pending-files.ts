import { useCallback, useState } from 'react';

import { getVsCodeApi } from '../utils/vscode-api.ts';

const vscode = getVsCodeApi();

export interface PendingFile {
  localId: string;
  name: string;
  size: number;
  status: 'uploading' | 'done' | 'error';
  fileId?: string;
}

/** Reads a File/Blob into a base64 string (stripping the "data:mime;base64,"
 * prefix) — same reason as use-pending-images.ts's identical helper: only
 * the extension host can reach storage-service with a bearer token, so the
 * raw bytes have to cross the postMessage boundary as base64. */
function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Owns attached (non-image) files pending send — mirrors use-pending-images.ts
 * exactly, except there's no createObjectURL preview (a generic file has
 * nothing to thumbnail); the composer shows name+size instead. Upload
 * happens via a postMessage round-trip to the extension host
 * (ChatPanelProvider's 'attachFile' case -> coding-api.ts's uploadFile).
 */
export function usePendingFiles() {
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);

  const addFile = useCallback((file: File) => {
    const localId = `file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPendingFiles((prev) => [
      ...prev,
      { localId, name: file.name, size: file.size, status: 'uploading' },
    ]);
    void fileToBase64(file).then((dataBase64) => {
      vscode.postMessage({
        command: 'attachFile',
        localId,
        dataBase64,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
      });
    });
  }, []);

  const removeFile = useCallback((localId: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.localId !== localId));
  }, []);

  /** Applies a 'fileUploaded' extension message. */
  const markUploaded = useCallback((localId: string, fileId: string) => {
    setPendingFiles((prev) =>
      prev.map((f) => (f.localId === localId ? { ...f, status: 'done', fileId } : f)),
    );
  }, []);

  /** Applies a 'fileUploadFailed' extension message. */
  const markFailed = useCallback((localId: string) => {
    setPendingFiles((prev) =>
      prev.map((f) => (f.localId === localId ? { ...f, status: 'error' } : f)),
    );
  }, []);

  /** Clears all pending files — called after a successful send. */
  const clear = useCallback(() => {
    setPendingFiles([]);
  }, []);

  const doneFiles = pendingFiles.filter(
    (f): f is PendingFile & { fileId: string } => f.status === 'done' && !!f.fileId,
  );
  const doneFileIds = doneFiles.map((f) => f.fileId);
  const hasUploading = pendingFiles.some((f) => f.status === 'uploading');

  return {
    pendingFiles,
    addFile,
    removeFile,
    markUploaded,
    markFailed,
    clear,
    doneFiles,
    doneFileIds,
    hasUploading,
  };
}
