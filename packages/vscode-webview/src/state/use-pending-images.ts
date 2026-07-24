import { useCallback, useState } from 'react';

import { getVsCodeApi } from '../utils/vscode-api.ts';

const vscode = getVsCodeApi();

export interface PendingImage {
  localId: string;
  previewUrl: string;
  status: 'uploading' | 'done' | 'error';
  imageId?: string;
}

/** Reads a File/Blob into a base64 string (stripping the "data:mime;base64,"
 * prefix) — the only way to hand pasted image bytes to the extension host,
 * since postMessage payloads must be JSON-serializable and the host (Node,
 * not a browser) has no createObjectURL/Blob-from-clipboard path of its
 * own. */
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
 * Owns pasted/attached images pending send — mirrors digital-factory-ui's
 * own pendingImages state (agent-chat-panel.tsx). Upload happens via a
 * postMessage round-trip to the extension host (ChatPanelProvider's
 * 'pasteImage' case → coding-api.ts's uploadImage), since only the host has
 * a bearer token and can hit storage-service directly.
 */
export function usePendingImages() {
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);

  const addImage = useCallback((file: File | Blob) => {
    const localId = `img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const previewUrl = URL.createObjectURL(file);
    setPendingImages((prev) => [...prev, { localId, previewUrl, status: 'uploading' }]);
    void fileToBase64(file).then((dataBase64) => {
      vscode.postMessage({
        command: 'pasteImage',
        localId,
        dataBase64,
        mimeType: file.type || 'image/png',
      });
    });
  }, []);

  const removeImage = useCallback((localId: string) => {
    setPendingImages((prev) => {
      const target = prev.find((p) => p.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.localId !== localId);
    });
  }, []);

  /** Applies an 'imageUploaded' extension message. */
  const markUploaded = useCallback((localId: string, imageId: string) => {
    setPendingImages((prev) =>
      prev.map((p) => (p.localId === localId ? { ...p, status: 'done', imageId } : p)),
    );
  }, []);

  /** Applies an 'imageUploadFailed' extension message. */
  const markFailed = useCallback((localId: string) => {
    setPendingImages((prev) =>
      prev.map((p) => (p.localId === localId ? { ...p, status: 'error' } : p)),
    );
  }, []);

  /** Clears all pending images (revoking their object URLs) — called after
   * a successful send, mirroring digital-factory-ui's setPendingImages([]). */
  const clear = useCallback(() => {
    setPendingImages((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
  }, []);

  const doneImageIds = pendingImages
    .filter((p): p is PendingImage & { imageId: string } => p.status === 'done' && !!p.imageId)
    .map((p) => p.imageId);
  const hasUploading = pendingImages.some((p) => p.status === 'uploading');

  return {
    pendingImages,
    addImage,
    removeImage,
    markUploaded,
    markFailed,
    clear,
    doneImageIds,
    hasUploading,
  };
}
